import type Anthropic from "@anthropic-ai/sdk";
import { estimateLeg, legsFor, orderStops, scheduleScore, timings, totals, type LatLng, type RouteStop, type ScheduleScore } from "@/lib/domain/routing";

// D-07 (revised 2026-10-07, owner decision): the AI route planner.
//
// A language model is good at judgment (an access note that says "after 2",
// a cluster that should be done before school traffic, why one order beats
// another) and poor at exact arithmetic over many permutations. So the model
// never computes a drive time itself: it plans with tools that measure on our
// own map model, starts from our own solver's best order, and every order it
// submits is measured by the same code. A proposal later or much longer than
// the solver's is refused and the model is told why; after two refusals the
// solver's order stands. The dispatcher still sees a preview and decides.
//
// Privacy (NFR-08): the model sees stop aliases (S1, S2...), service type,
// window, duration, position in km from the office, and the access and visit
// notes with numbers, emails and phone numbers removed. No names, addresses,
// coordinates, phone numbers or gate codes leave our servers.
//
// Steps (D-04): each call to `advance` runs model turns until its time budget
// is spent, then returns its state; the caller stores it and calls again. The
// conversation is replayed unchanged (append only), as the model requires.

export const MAX_TURNS = 14;
const MAX_REJECTIONS = 2;
/** How much longer than the solver's driving a proposal may be, to honour notes the solver cannot read. */
export const DRIVE_SLACK = 0.1;

export interface PlannerStop extends RouteStop {
  serviceType: string;
  /** Access and visit notes, already redacted. */
  note: string | null;
}

export interface PlannerProblem {
  start: LatLng | null;
  dayStart: string;
  stops: PlannerStop[];
  /** Current order of the placed stops, by id. */
  current: string[];
}

export interface PlannerResult {
  order: string[];
  summary: string;
  reasons: { id: string; reason: string }[];
  /** "ai": the model's order was accepted; "solver": ours stands (see `note`). */
  source: "ai" | "solver";
  note: string | null;
}

export interface PlannerState {
  /** alias -> id, fixed at the first step. */
  aliases: Record<string, string>;
  messages: Anthropic.Beta.BetaMessageParam[];
  turns: number;
  rejections: number;
  usage: { input: number; output: number; cacheRead: number };
  result?: PlannerResult;
}

export type CreateMessage = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;

export interface PlannerDeps {
  create: CreateMessage;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  now?: () => number;
}

// Redaction ---------------------------------------------------------------------

/** Notes keep their meaning ("gate on the left, dog in yard, after 2 pm") but lose codes and contact details. */
export function redactNote(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[phone]")
    // Times stay ("2 pm", "14:30"); other runs of 3+ digits are codes.
    .replace(/\b(?!\d{1,2}:\d{2}\b)\d{3,}\b/g, "[number]")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 200) : null;
}

// The map the model sees ---------------------------------------------------------

function kmFrom(origin: LatLng, p: LatLng): { east: number; north: number } {
  const north = ((p.lat - origin.lat) * Math.PI * 6371.0088) / 180;
  const east = ((p.lng - origin.lng) * Math.PI * 6371.0088 * Math.cos((origin.lat * Math.PI) / 180)) / 180;
  return { east: Math.round(east * 10) / 10, north: Math.round(north * 10) / 10 };
}

function origin(problem: PlannerProblem): LatLng {
  if (problem.start) return problem.start;
  const n = problem.stops.length || 1;
  return { lat: problem.stops.reduce((s, p) => s + p.lat, 0) / n, lng: problem.stops.reduce((s, p) => s + p.lng, 0) / n };
}

const minutesText = (seconds: number) => Math.round(seconds / 60);

interface Measured {
  score: ScheduleScore;
  seconds: number;
  meters: number;
  lines: string[];
}

function measure(problem: PlannerProblem, order: PlannerStop[], alias: (id: string) => string): Measured {
  const legs = legsFor(order, problem.start);
  const t = totals(legs);
  const times = timings(order, legs, problem.dayStart);
  const legTo = new Map(legs.map((l) => [l.toId, l]));
  const lines = order.map((s, i) => {
    const tm = times[i]!;
    const leg = legTo.get(s.id);
    const window = s.windowStart || s.windowEnd ? ` window ${s.windowStart ?? "any"}-${s.windowEnd ?? "any"}` : "";
    return `${i + 1}. ${alias(s.id)} drive ${leg ? minutesText(leg.seconds) : 0} min, arrive ${tm.arrival}${tm.waitMin >= 1 ? ` (waits ${Math.round(tm.waitMin)} min)` : ""}${window}${tm.late ? " LATE" : ""}`;
  });
  return { score: scheduleScore(order, problem.start, problem.dayStart), seconds: t.seconds, meters: t.meters, lines };
}

function scoreText(m: Measured): string {
  return `${m.score.late} late (${Math.round(m.score.lateMin)} min past windows), ${minutesText(m.seconds)} min driving, ${(m.meters / 1000).toFixed(1)} km`;
}

/** Accepted when no later than the solver and not much longer, or plainly better. */
export function acceptable(proposal: Measured | { score: ScheduleScore }, solver: Measured | { score: ScheduleScore }): { ok: true } | { ok: false; why: string } {
  const p = proposal.score;
  const s = solver.score;
  if (p.late > s.late) return { ok: false, why: `it has ${p.late} late arrivals; the solver's order has ${s.late}` };
  if (p.late === s.late && p.lateMin > s.lateMin + 5) return { ok: false, why: `it is ${Math.round(p.lateMin - s.lateMin)} minutes later past windows than the solver's order` };
  if (p.late < s.late || p.lateMin < s.lateMin - 5) return { ok: true };
  if (p.meters > s.meters * (1 + DRIVE_SLACK)) {
    return { ok: false, why: `it drives ${Math.round((p.meters / s.meters - 1) * 100)}% farther than the solver's order (the limit is ${DRIVE_SLACK * 100}%, and only to honour a note)` };
  }
  return { ok: true };
}

// Prompt and tools ---------------------------------------------------------------

export const SYSTEM_PROMPT = `You plan the order of one pest control technician's stops for one working day.

What a good day looks like, in priority order:
1. Every stop reached inside its arrival window. A late arrival is the worst outcome: the customer was promised a time.
2. Notes honoured where they matter for timing or order: "after 2", "mornings only", "call ahead", "dog out until noon", "gate locked before 9". A note that does not affect order or timing (a gate location, where the spigot is) changes nothing.
3. The least total driving. Avoid crossing back over ground already covered; finish stops in one area before moving to the next.
4. Sensible waiting: a short wait for a window to open is fine; a long idle gap usually means a better order exists.

How you work:
- Distances and times come only from the tools. Never estimate a drive time or an arrival yourself; call measure_route or travel_times.
- You are given the current order and the solver's best order with their measurements. The solver is strong on distance and windows but cannot read notes. Start from its order and improve only where you have a reason: a note, a window, or a measured saving.
- Try alternatives with measure_route before deciding. A change that only moves a stop one or two places usually saves little; look for bigger structural problems first (a stop far out of the way, an area visited twice).
- When you are done, call submit_route exactly once with every stop exactly once. Keep reasons short and concrete, written for a dispatcher: "S4 moved after S9: note says no service before 2 pm." Only give a reason for a stop whose position you changed from the solver's order on purpose.
- If the solver's order is already the best you can find, submit it and say so in the summary. That is a good outcome, not a failure.
- The summary is one or two plain sentences for the dispatcher. No jargon, no hedging, no repetition of numbers the screen already shows.

Positions are kilometres east and north of the office (or of the middle of the day's stops when no office is set). Roads are not straight; the tools account for that.`;

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): Anthropic.Beta.BetaTool {
  return { name, description, strict: true, input_schema: { type: "object", properties, required, additionalProperties: false } };
}

const ORDER = { type: "array", items: { type: "string" }, description: "Every stop alias exactly once, in visiting order." };

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  tool(
    "measure_route",
    "Measure a complete visiting order on the map: drive time into each stop, arrival time, waits, window misses (LATE), and totals. Use it to compare alternatives before submitting.",
    { order: ORDER },
    ["order"],
  ),
  tool(
    "travel_times",
    "Drive time and distance from one stop (or OFFICE) to several others, nearest first. Use it to find which stops sit together.",
    { from: { type: "string", description: "A stop alias or OFFICE." }, to: { type: "array", items: { type: "string" }, description: "Stop aliases. Empty means every stop." } },
    ["from", "to"],
  ),
  tool(
    "submit_route",
    "Submit the final order. It is measured and checked against the solver's order; if it is refused you are told why and may submit again.",
    {
      order: ORDER,
      summary: { type: "string", description: "One or two sentences for the dispatcher." },
      reasons: {
        type: "array",
        items: { type: "object", properties: { stop: { type: "string" }, reason: { type: "string" } }, required: ["stop", "reason"], additionalProperties: false },
        description: "Only stops moved on purpose from the solver's order.",
      },
    },
    ["order", "summary", "reasons"],
  ),
];

export function describeProblem(problem: PlannerProblem, aliases: Record<string, string>): string {
  const byId = new Map(problem.stops.map((s) => [s.id, s]));
  const aliasOf = new Map(Object.entries(aliases).map(([a, id]) => [id, a]));
  const alias = (id: string) => aliasOf.get(id) ?? id;
  const o = origin(problem);
  const stopLines = problem.stops.map((s) => {
    const pos = kmFrom(o, s);
    const window = s.windowStart || s.windowEnd ? `window ${s.windowStart ?? "any"} to ${s.windowEnd ?? "any"}` : "any time";
    return `${alias(s.id)}: ${s.serviceType}, ${s.durationMin} min on site, ${window}, at ${pos.east} km east ${pos.north} km north${s.note ? `. Notes: "${s.note}"` : ""}`;
  });
  const current = problem.current.map((id) => byId.get(id)!).filter(Boolean);
  const solver = orderStops(problem.stops, problem.start, { dayStart: problem.dayStart }) as PlannerStop[];
  const now = measure(problem, current, alias);
  const best = measure(problem, solver, alias);
  return [
    `The technician leaves ${problem.start ? "the office" : "from the first stop"} at ${problem.dayStart}. ${problem.stops.length} stops:`,
    ...stopLines,
    "",
    `Current order (${scoreText(now)}):`,
    current.map((s) => alias(s.id)).join(", "),
    "",
    `Solver's best order (${scoreText(best)}):`,
    solver.map((s) => alias(s.id)).join(", "),
    "",
    "Plan the day. Measure what you try, then submit.",
  ].join("\n");
}

// The loop -------------------------------------------------------------------------

export function startState(problem: PlannerProblem): PlannerState {
  const aliases: Record<string, string> = {};
  problem.stops.forEach((s, i) => (aliases[`S${i + 1}`] = s.id));
  return { aliases, messages: [{ role: "user", content: describeProblem(problem, aliases) }], turns: 0, rejections: 0, usage: { input: 0, output: 0, cacheRead: 0 } };
}

function solverResult(problem: PlannerProblem, note: string): PlannerResult {
  const order = orderStops(problem.stops, problem.start, { dayStart: problem.dayStart }).map((s) => s.id);
  return { order, summary: "This is the built-in solver's order: fewest late arrivals, then least driving.", reasons: [], source: "solver", note };
}

type ToolOutcome = { text: string; isError?: boolean; result?: PlannerResult };

function runTool(problem: PlannerProblem, state: PlannerState, name: string, input: unknown): ToolOutcome {
  const byAlias = new Map(Object.entries(state.aliases));
  const aliasOf = new Map(Object.entries(state.aliases).map(([a, id]) => [id, a]));
  const alias = (id: string) => aliasOf.get(id) ?? id;
  const stopById = new Map(problem.stops.map((s) => [s.id, s]));
  const args = (input ?? {}) as Record<string, unknown>;

  const readOrder = (): PlannerStop[] | string => {
    const raw = args.order;
    if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string")) return "order must be a list of stop aliases.";
    const seen = new Set<string>();
    const out: PlannerStop[] = [];
    for (const a of raw as string[]) {
      const id = byAlias.get(a.trim().toUpperCase());
      if (!id) return `Unknown stop ${a}.`;
      if (seen.has(id)) return `${a} appears twice.`;
      seen.add(id);
      out.push(stopById.get(id)!);
    }
    const missing = problem.stops.filter((s) => !seen.has(s.id)).map((s) => alias(s.id));
    if (missing.length) return `Every stop must appear once. Missing: ${missing.join(", ")}.`;
    return out;
  };

  if (name === "measure_route") {
    const order = readOrder();
    if (typeof order === "string") return { text: order, isError: true };
    const m = measure(problem, order, alias);
    return { text: [`Totals: ${scoreText(m)}`, ...m.lines].join("\n") };
  }

  if (name === "travel_times") {
    const from = typeof args.from === "string" ? args.from.trim().toUpperCase() : "";
    const fromPoint = from === "OFFICE" ? problem.start : (stopById.get(byAlias.get(from) ?? "") ?? null);
    if (!fromPoint) return { text: from === "OFFICE" ? "No office location is set; start from a stop instead." : `Unknown stop ${String(args.from)}.`, isError: true };
    const wanted = Array.isArray(args.to) && args.to.length ? (args.to as string[]).map((a) => byAlias.get(String(a).trim().toUpperCase())).filter((x): x is string => !!x) : problem.stops.map((s) => s.id);
    const rows = wanted
      .filter((id) => !(from !== "OFFICE" && byAlias.get(from) === id))
      .map((id) => ({ id, ...estimateLeg(fromPoint, stopById.get(id)!) }))
      .sort((a, b) => a.seconds - b.seconds)
      .map((r) => `${alias(r.id)}: ${minutesText(r.seconds)} min, ${(r.meters / 1000).toFixed(1)} km`);
    return { text: rows.join("\n") || "No stops matched." };
  }

  if (name === "submit_route") {
    const order = readOrder();
    if (typeof order === "string") return { text: order, isError: true };
    const solver = orderStops(problem.stops, problem.start, { dayStart: problem.dayStart }) as PlannerStop[];
    const mine = measure(problem, order, alias);
    const theirs = measure(problem, solver, alias);
    const verdict = acceptable(mine, theirs);
    if (!verdict.ok) {
      state.rejections += 1;
      if (state.rejections > MAX_REJECTIONS) return { text: "Refused again; the solver's order will be used.", result: solverResult(problem, `The AI's order was refused: ${verdict.why}.`) };
      return { text: `Refused: ${verdict.why}. Measure alternatives and submit again, or submit the solver's order.`, isError: true };
    }
    const reasons = Array.isArray(args.reasons)
      ? (args.reasons as { stop?: unknown; reason?: unknown }[])
          .map((r) => ({ id: byAlias.get(String(r.stop ?? "").trim().toUpperCase()), reason: String(r.reason ?? "").slice(0, 240) }))
          .filter((r): r is { id: string; reason: string } => !!r.id && !!r.reason)
      : [];
    const summary = typeof args.summary === "string" && args.summary.trim() ? args.summary.trim().slice(0, 400) : "Planned by the AI route planner.";
    const ids = order.map((s) => s.id);
    return { text: "Accepted.", result: { order: ids, summary: unalias(summary, state.aliases, ids), reasons: reasons.map((r) => ({ ...r, reason: unalias(r.reason, state.aliases, ids) })), source: "ai", note: null } };
  }

  return { text: `Unknown tool ${name}.`, isError: true };
}

/** Aliases mean nothing to a dispatcher: "S4" becomes "stop 6", its number in the new order. */
export function unalias(text: string, aliases: Record<string, string>, order: readonly string[]): string {
  return text.replace(/\bS(\d+)\b/g, (whole, n: string) => {
    const at = order.indexOf(aliases[`S${n}`] ?? "");
    return at >= 0 ? `stop ${at + 1}` : whole;
  });
}

/**
 * Run model turns until the plan is submitted, the turn limit is reached, or
 * the time budget for this step is spent. Returns the updated state; when
 * `state.result` is set the run is finished.
 */
export async function advance(problem: PlannerProblem, state: PlannerState, deps: PlannerDeps, budgetMs: number): Promise<PlannerState> {
  const now = deps.now ?? Date.now;
  const started = now();
  if (problem.stops.length < 2) return { ...state, result: { order: problem.stops.map((s) => s.id), summary: "Nothing to reorder.", reasons: [], source: "solver", note: null } };

  while (!state.result) {
    if (state.turns >= MAX_TURNS) {
      state.result = solverResult(problem, "The AI ran out of turns before submitting, so the solver's order is shown.");
      break;
    }
    if (state.turns > 0 && now() - started > budgetMs) break;

    const response = await deps.create({
      model: deps.model,
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      tool_choice: { type: "auto" },
      output_config: { effort: deps.effort },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: state.messages,
    });
    state.turns += 1;
    state.usage.input += response.usage.input_tokens ?? 0;
    state.usage.output += response.usage.output_tokens ?? 0;
    state.usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;

    if (response.stop_reason === "refusal") {
      state.result = solverResult(problem, "The AI declined this request, so the solver's order is shown.");
      break;
    }
    // Append exactly what came back: thinking blocks must be replayed unchanged.
    state.messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });

    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) {
      if (response.stop_reason === "max_tokens") {
        state.messages.push({ role: "user", content: "You ran out of room. Be brief: measure at most one more alternative, then call submit_route." });
      } else {
        state.messages.push({ role: "user", content: "Call submit_route with your final order." });
      }
      continue;
    }
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const out = runTool(problem, state, call.name, call.input);
      results.push({ type: "tool_result", tool_use_id: call.id, content: out.text, ...(out.isError ? { is_error: true } : {}) });
      if (out.result && !state.result) state.result = out.result;
    }
    state.messages.push({ role: "user", content: results });
  }
  return state;
}

export { solverResult };
