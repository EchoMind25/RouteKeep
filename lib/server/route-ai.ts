import "server-only";
import type { MemberSession } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import type { LocalDate } from "@/lib/domain/time";
import { env } from "@/lib/env";
import type { RoutePlan } from "@/lib/providers/route-optimizer";
import type { PlannerResult } from "@/lib/routing/ai-planner";
import { aiLaneProblem, RouteConflictError } from "@/lib/server/dispatch";

// D-07 (revised): asking for an AI plan and reading it back. The work itself
// happens in lib/jobs/route-ai.ts, one short step per request.

export function aiPlannerAvailable(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY);
}

export interface AiPlanView {
  id: string;
  technicianId: string;
  status: "queued" | "running" | "done" | "failed";
  expected: string[];
  error: string | null;
  plan: (PlannerResult & { current: RoutePlan; proposed: RoutePlan; unplaced: string[] }) | null;
}

export async function requestAiPlan(m: MemberSession, input: { technicianId: string; date: LocalDate; key: string }): Promise<string> {
  return withRls(m.claims, async (tx) => {
    const { expected, problem, unplaced } = await aiLaneProblem(tx, input.technicianId, input.date);
    if (problem.stops.length < 2) throw new RouteConflictError();
    // ENG-01: the same click twice is the same run. Conflict is absorbed by the
    // insert itself; catching a unique violation would leave the transaction aborted (25P02).
    const row = await tx
      .insertInto("route_ai_runs")
      .values({
        technician_id: input.technicianId,
        local_date: input.date,
        request_key: input.key,
        expected: JSON.stringify(expected),
        state: JSON.stringify({ problem, unplaced }),
      })
      .onConflict((oc) => oc.constraint("route_ai_runs_request_key").doNothing())
      .returning("id")
      .executeTakeFirst();
    if (row) return row.id;
    return (await tx.selectFrom("route_ai_runs").select("id").where("request_key", "=", input.key).executeTakeFirstOrThrow()).id;
  });
}

export async function readAiPlan(m: MemberSession, runId: string): Promise<AiPlanView | null> {
  return withRls(m.claims, async (tx) => {
    const row = await tx
      .selectFrom("route_ai_runs")
      .select(["id", "technician_id", "status", "expected", "error", "result", "tenant_id"])
      .where("id", "=", runId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      technicianId: row.technician_id,
      status: row.status as AiPlanView["status"],
      expected: row.expected as string[],
      error: row.error,
      plan: (row.result as AiPlanView["plan"]) ?? null,
    };
  });
}

/** The tenant a member's run belongs to, if they can see it: the step runs only for runs the caller can read. */
export async function aiRunTenant(m: MemberSession, runId: string): Promise<string | null> {
  return withRls(m.claims, async (tx) => (await tx.selectFrom("route_ai_runs").select("tenant_id").where("id", "=", runId).executeTakeFirst())?.tenant_id ?? null);
}
