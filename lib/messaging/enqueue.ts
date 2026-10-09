import "server-only";
import { createHash } from "node:crypto";
import { sql } from "kysely";
import type { Tx } from "@/lib/db/rls";
import type { Topic } from "./templates";

// ENG-04: a message is written to the outbox in the same transaction as the
// thing it is about, and sent only after that commits. The priority lane
// (0 for on-the-way, completed, sign-in and payment.* topics, FR-MSG-01) is set
// by the outbox_events_priority trigger, so every insert path agrees. The event id is derived
// from what the message is about, so a retried request queues it once.

export function eventId(...parts: string[]): string {
  const h = createHash("sha256").update(parts.join("|")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function enqueueEmail(tx: Tx, input: { tenantId: string; topic: Topic; key: string; payload: Record<string, unknown>; availableAt?: Date }) {
  // Through app.enqueue_outbox: members may queue but not read the outbox.
  await sql`select app.enqueue_outbox(${input.tenantId}::uuid, ${eventId(input.tenantId, input.topic, input.key)}::uuid, 'email', ${input.topic}, ${JSON.stringify(input.payload)}::jsonb, ${input.availableAt ?? null}::timestamptz)`.execute(tx);
}
