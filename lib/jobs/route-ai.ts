import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "kysely";
import { withServiceRole } from "@/lib/db/service";
import { env } from "@/lib/env";
import { estimateOptimizer } from "@/lib/providers/route-optimizer";
import { advance, solverResult, startState, type CreateMessage, type PlannerProblem, type PlannerResult, type PlannerState } from "@/lib/routing/ai-planner";

// D-07 (revised), D-04: one step of an AI route plan. A step claims the run
// for a short lease (so two browser tabs never drive it at once), runs model
// turns until its time budget is spent, and saves the conversation. The step
// that ends the run measures the result on our own map model and stores it
// for the preview. If the model cannot be reached the solver's order is
// offered instead, with the reason, so the dispatcher is never left waiting.

interface Stored {
  problem: PlannerProblem;
  unplaced: string[];
  planner?: PlannerState;
}

let client: Anthropic | null = null;
function defaultCreate(): CreateMessage {
  client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, baseURL: env().ANTHROPIC_BASE_URL, timeout: 55_000, maxRetries: 1 });
  const c = client;
  return (params) => c.beta.messages.create(params);
}

export async function stepAiRun(tenantId: string, runId: string, create: CreateMessage = defaultCreate()): Promise<"done" | "working" | "busy"> {
  const claimed = await withServiceRole((tx) =>
    tx
      .updateTable("route_ai_runs")
      .set({ status: "running", lease_until: sql`now() + interval '75 seconds'`, started_at: sql`coalesce(started_at, now())` })
      .where("id", "=", runId)
      .where("tenant_id", "=", tenantId)
      .where("status", "in", ["queued", "running"])
      .where((eb) => eb.or([eb("lease_until", "is", null), eb("lease_until", "<", sql<Date>`now()`)]))
      .returning(["state"])
      .executeTakeFirst(),
  );
  if (!claimed) return "busy";
  const stored = claimed.state as unknown as Stored;
  const e = env();
  let planner = stored.planner ?? startState(stored.problem);
  let note: string | null = null;
  try {
    planner = await advance(stored.problem, planner, { create, model: e.ROUTE_AI_MODEL, effort: e.ROUTE_AI_EFFORT }, e.ROUTE_AI_STEP_MS);
  } catch (error) {
    console.error(JSON.stringify({ msg: "route ai step failed", runId, error: error instanceof Error ? error.message : String(error) }));
    note =
      error instanceof Anthropic.AuthenticationError
        ? "The AI planner's key was refused, so the built-in solver's order is shown. Check ANTHROPIC_API_KEY."
        : error instanceof Anthropic.RateLimitError
          ? "The AI planner is busy right now, so the built-in solver's order is shown. Try again in a minute."
          : "The AI planner could not be reached, so the built-in solver's order is shown.";
    planner.result = solverResult(stored.problem, note);
  }

  if (!planner.result) {
    await withServiceRole((tx) =>
      tx.updateTable("route_ai_runs").set({ state: JSON.stringify({ ...stored, planner }), lease_until: null, usage: JSON.stringify(planner.usage) }).where("id", "=", runId).where("tenant_id", "=", tenantId).execute(),
    );
    return "working";
  }

  const result: PlannerResult = planner.result;
  const byId = new Map(stored.problem.stops.map((s) => [s.id, s]));
  const input = { start: stored.problem.start, dayStart: stored.problem.dayStart };
  const current = await estimateOptimizer.measure({ ...input, stops: stored.problem.current.map((id) => byId.get(id)!) });
  const proposed = { ...(await estimateOptimizer.measure({ ...input, stops: result.order.map((id) => byId.get(id)!) })), provider: result.source === "ai" ? "ai" : "estimate" };
  await withServiceRole((tx) =>
    tx
      .updateTable("route_ai_runs")
      .set({
        status: "done",
        result: JSON.stringify({ ...result, current, proposed, unplaced: stored.unplaced }),
        // The conversation has done its job; keep only what is needed to audit cost.
        state: JSON.stringify({ problem: stored.problem, unplaced: stored.unplaced, turns: planner.turns, rejections: planner.rejections }),
        usage: JSON.stringify(planner.usage),
        model: e.ROUTE_AI_MODEL,
        lease_until: null,
        finished_at: new Date(),
      })
      .where("id", "=", runId)
      .where("tenant_id", "=", tenantId)
      .execute(),
  );
  return "done";
}
