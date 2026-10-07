import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { orderStops } from "@/lib/domain/routing";
import { acceptable, advance, describeProblem, MAX_TURNS, redactNote, startState, unalias, type CreateMessage, type PlannerProblem } from "./ai-planner";

// D-07 (revised): the AI planner's guard rails, with a scripted model. No
// network: each test hands the planner the replies a model would give.

const OFFICE = { lat: 40.2969, lng: -111.6946 };
const stop = (id: string, east: number, north: number, extra: Partial<PlannerProblem["stops"][number]> = {}) => ({
  id,
  lat: OFFICE.lat + north / 111.2,
  lng: OFFICE.lng + east / 85,
  durationMin: 20,
  windowStart: null,
  windowEnd: null,
  serviceType: "General pest",
  note: null,
  ...extra,
});

const problem: PlannerProblem = {
  start: OFFICE,
  dayStart: "08:00",
  stops: [stop("a", 1, 0), stop("b", 2, 0), stop("c", 3, 0), stop("d", 4, 0, { note: "after 2 pm", windowStart: "14:00", windowEnd: "17:00" })],
  current: ["d", "c", "b", "a"],
};

let n = 0;
function reply(blocks: Anthropic.Beta.BetaContentBlock[], stop_reason: Anthropic.Beta.BetaMessage["stop_reason"] = "tool_use"): Anthropic.Beta.BetaMessage {
  return { id: `msg_${n++}`, type: "message", role: "assistant", model: "test", content: blocks, stop_reason, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } } as unknown as Anthropic.Beta.BetaMessage;
}
const call = (name: string, input: unknown) => ({ type: "tool_use", id: `tu_${n++}`, name, input }) as Anthropic.Beta.BetaContentBlock;

function scripted(...replies: Anthropic.Beta.BetaMessage[]): { create: CreateMessage; seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] } {
  const seen: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  return {
    seen,
    create: async (params) => {
      seen.push(structuredClone(params));
      const next = replies.shift();
      if (!next) throw new Error("no more scripted replies");
      return next;
    },
  };
}

const deps = (create: CreateMessage) => ({ create, model: "test-model", effort: "high" as const });

describe("redactNote", () => {
  it("keeps meaning and times but drops codes, phones and emails", () => {
    expect(redactNote("Gate code 4471, call 801-555-0142 or jo@example.com. Not before 14:30, dog out")).toBe(
      "Gate code [number], call [phone] or [email]. Not before 14:30, dog out",
    );
    expect(redactNote("   ")).toBeNull();
  });
});

describe("the problem the model sees", () => {
  it("uses aliases and kilometres, never ids, names or coordinates", () => {
    const state = startState(problem);
    const text = describeProblem(problem, state.aliases);
    expect(text).toContain("S4: General pest");
    expect(text).toContain('Notes: "after 2 pm"');
    expect(text).toMatch(/at 4 km east 0 km north/);
    expect(text).not.toContain("40.29");
    expect(text).not.toMatch(/\b[abcd]\b,/);
  });
});

describe("acceptable", () => {
  const s = { score: { late: 0, lateMin: 0, meters: 10_000 } };
  it("refuses later or much longer orders and allows a small detour", () => {
    expect(acceptable({ score: { late: 1, lateMin: 3, meters: 9000 } }, s).ok).toBe(false);
    expect(acceptable({ score: { late: 0, lateMin: 0, meters: 11_500 } }, s).ok).toBe(false);
    expect(acceptable({ score: { late: 0, lateMin: 0, meters: 10_900 } }, s).ok).toBe(true);
    expect(acceptable({ score: { late: 0, lateMin: 0, meters: 20_000 } }, { score: { late: 1, lateMin: 30, meters: 5000 } }).ok).toBe(true);
  });
});

describe("advance", () => {
  it("measures, submits, and maps aliases back to ids and stop numbers", async () => {
    const { create, seen } = scripted(
      reply([call("measure_route", { order: ["S1", "S2", "S3", "S4"] })]),
      reply([call("submit_route", { order: ["S1", "S2", "S3", "S4"], summary: "Kept the solver's order; S4 waits for its afternoon window.", reasons: [{ stop: "S4", reason: "Note says after 2 pm." }] })]),
    );
    const state = await advance(problem, startState(problem), deps(create), 60_000);
    expect(state.result).toEqual({
      order: ["a", "b", "c", "d"],
      summary: "Kept the solver's order; stop 4 waits for its afternoon window.",
      reasons: [{ id: "d", reason: "Note says after 2 pm." }],
      source: "ai",
      note: null,
    });
    // The second request replays the first reply and its tool result unchanged.
    const replay = seen[1]!.messages;
    expect(replay).toHaveLength(3);
    expect(replay[2]!.content).toEqual([expect.objectContaining({ type: "tool_result", content: expect.stringContaining("Totals: 0 late") })]);
    expect(seen[0]!.tool_choice).toEqual({ type: "auto" });
  });

  it("refuses a worse order, then falls back to the solver after repeated refusals", async () => {
    const bad = { order: ["S4", "S1", "S3", "S2"], summary: "x", reasons: [] };
    const { create } = scripted(reply([call("submit_route", bad)]), reply([call("submit_route", bad)]), reply([call("submit_route", bad)]));
    const state = await advance(problem, startState(problem), deps(create), 60_000);
    expect(state.rejections).toBe(3);
    expect(state.result?.source).toBe("solver");
    expect(state.result?.order).toEqual(orderStops(problem.stops, problem.start, { dayStart: "08:00" }).map((s) => s.id));
    expect(state.result?.note).toMatch(/refused/);
  });

  it("rejects an order that skips or repeats a stop, as a tool error", async () => {
    const { create, seen } = scripted(
      reply([call("measure_route", { order: ["S1", "S1", "S2"] })]),
      reply([call("submit_route", { order: ["S1", "S2", "S3", "S4"], summary: "ok", reasons: [] })]),
    );
    await advance(problem, startState(problem), deps(create), 60_000);
    expect(seen[1]!.messages[2]!.content).toEqual([expect.objectContaining({ is_error: true, content: "S1 appears twice." })]);
  });

  it("stops at the step's time budget and resumes where it left off", async () => {
    let clock = 0;
    const { create } = scripted(
      reply([call("measure_route", { order: ["S1", "S2", "S3", "S4"] })]),
      reply([call("submit_route", { order: ["S1", "S2", "S3", "S4"], summary: "ok", reasons: [] })]),
    );
    const slow: CreateMessage = async (p) => {
      clock += 30_000;
      return create(p);
    };
    const first = await advance(problem, startState(problem), { ...deps(slow), now: () => clock }, 20_000);
    expect(first.result).toBeUndefined();
    expect(first.turns).toBe(1);
    const second = await advance(problem, JSON.parse(JSON.stringify(first)), { ...deps(slow), now: () => clock }, 20_000);
    expect(second.result?.source).toBe("ai");
  });

  it("falls back on a refusal stop reason and after too many turns", async () => {
    const refused = await advance(problem, startState(problem), deps(scripted(reply([], "refusal")).create), 60_000);
    expect(refused.result?.source).toBe("solver");
    const chatty = Array.from({ length: MAX_TURNS }, () => reply([call("travel_times", { from: "OFFICE", to: [] })]));
    const tired = await advance(problem, startState(problem), deps(scripted(...chatty).create), 600_000);
    expect(tired.result?.note).toMatch(/ran out of turns/);
  });

  it("unalias leaves unknown aliases alone", () => {
    expect(unalias("S9 and S1", { S1: "a" }, ["b", "a"])).toBe("S9 and stop 2");
  });
});
