"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMember } from "@/lib/auth/session";
import { isLocalDate, type LocalDate } from "@/lib/domain/time";
import {
  commitOptimize,
  moveStop,
  moveStopToDay,
  previewOptimize,
  publishRoute,
  RouteConflictError,
  scheduleStop,
  undoOptimize,
  type OptimizePreview,
} from "@/lib/server/dispatch";
import { stepAiRun } from "@/lib/jobs/route-ai";
import { aiRunTenant, readAiPlan, requestAiPlan, type AiPlanView } from "@/lib/server/route-ai";

// The board is for people who run the schedule.
const DISPATCH = ["owner", "admin", "office", "dispatcher"] as const;

export type BoardResult = { ok: true } | { ok: false; message: string };

const date = z.string().refine(isLocalDate, "bad date").transform((v) => v as LocalDate);
const uuidOrNull = z.uuid().nullable();
/** A lane as the dispatcher saw it. 500 stops is the board's design ceiling for a whole day. */
const lane = z.array(z.uuid()).max(500);

async function run(fn: () => Promise<void>): Promise<BoardResult> {
  try {
    await fn();
    revalidatePath("/schedule");
    return { ok: true };
  } catch (error) {
    if (error instanceof RouteConflictError) {
      // The dispatcher's view is stale either way: send the current board back with the answer.
      revalidatePath("/schedule");
      return { ok: false, message: error.message };
    }
    if (error instanceof z.ZodError) return { ok: false, message: "That change could not be read. Reload the board and try again." };
    throw error;
  }
}

export async function moveStopAction(input: unknown): Promise<BoardResult> {
  const member = await requireMember(DISPATCH);
  return run(async () => {
    const v = z
      .object({
        id: z.uuid(),
        version: z.number().int().positive(),
        date,
        fromTechnicianId: uuidOrNull,
        toTechnicianId: uuidOrNull,
        toIndex: z.number().int().min(0),
        fromOrder: lane.nullable(),
        toOrder: lane.nullable(),
      })
      .parse(input);
    await moveStop(member, v);
  });
}

export async function moveStopToDayAction(input: unknown): Promise<BoardResult> {
  const member = await requireMember(DISPATCH);
  return run(async () => {
    const v = z.object({ id: z.uuid(), version: z.number().int().positive(), date, toDate: date }).parse(input);
    await moveStopToDay(member, v);
  });
}

export async function scheduleStopAction(input: unknown): Promise<BoardResult> {
  const member = await requireMember(DISPATCH);
  return run(async () => {
    const v = z
      .object({ id: z.uuid(), version: z.number().int().positive(), date, technicianId: uuidOrNull, toIndex: z.number().int().min(0), toOrder: lane.nullable() })
      .parse(input);
    await scheduleStop(member, v);
  });
}

export async function previewOptimizeAction(input: unknown): Promise<{ ok: true; preview: OptimizePreview } | { ok: false; message: string }> {
  const member = await requireMember(DISPATCH);
  const v = z.object({ technicianId: z.uuid(), date }).safeParse(input);
  if (!v.success) return { ok: false, message: "Reload the board and try again." };
  return { ok: true, preview: await previewOptimize(member, v.data.technicianId, v.data.date) };
}

export async function commitOptimizeAction(input: unknown): Promise<BoardResult> {
  const member = await requireMember(DISPATCH);
  return run(async () => {
    const v = z
      .object({
        technicianId: z.uuid(),
        date,
        order: lane,
        expected: lane,
        provider: z.string().max(40),
        stats: z.record(z.string(), z.number()).refine((r) => Object.keys(r).length <= 10, "too many stats"),
      })
      .parse(input);
    await commitOptimize(member, v);
  });
}

export async function undoOptimizeAction(input: unknown): Promise<BoardResult> {
  const member = await requireMember(DISPATCH);
  return run(async () => {
    const v = z.object({ technicianId: z.uuid(), date, expected: lane }).parse(input);
    await undoOptimize(member, v);
  });
}

export async function publishRouteAction(input: unknown): Promise<BoardResult> {
  const member = await requireMember(DISPATCH);
  return run(async () => {
    const v = z.object({ technicianId: z.uuid(), date, expected: lane, flaggedStops: z.number().int().min(0) }).parse(input);
    await publishRoute(member, v);
  });
}

// D-07 (revised): the AI route planner. Asking queues a run; the board then
// calls the step action until the plan is ready, each call a short request.

export async function requestAiPlanAction(input: unknown): Promise<{ ok: true; runId: string } | { ok: false; message: string }> {
  const member = await requireMember(DISPATCH);
  const v = z.object({ technicianId: z.uuid(), date, key: z.string().min(8).max(80) }).safeParse(input);
  if (!v.success) return { ok: false, message: "Reload the board and try again." };
  try {
    return { ok: true, runId: await requestAiPlan(member, v.data) };
  } catch (error) {
    if (error instanceof RouteConflictError) return { ok: false, message: "This route needs at least two stops with map pins to plan." };
    throw error;
  }
}

export async function stepAiPlanAction(input: unknown): Promise<{ ok: true; run: AiPlanView } | { ok: false; message: string }> {
  const member = await requireMember(DISPATCH);
  const v = z.object({ runId: z.uuid() }).safeParse(input);
  if (!v.success) return { ok: false, message: "Reload the board and try again." };
  const tenantId = await aiRunTenant(member, v.data.runId);
  if (!tenantId) return { ok: false, message: "That plan is no longer available." };
  await stepAiRun(tenantId, v.data.runId);
  const run = await readAiPlan(member, v.data.runId);
  return run ? { ok: true, run } : { ok: false, message: "That plan is no longer available." };
}
