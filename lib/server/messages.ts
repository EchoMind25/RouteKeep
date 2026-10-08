import "server-only";
import { sql } from "kysely";
import type { MemberSession } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import { emailProvider } from "@/lib/env";

// FR-MSG-03, FR-MSG-05, FR-MIG-19, FR-POR-02: what the office sees and sets
// about messages, and the service requests customers send from the portal.

export interface MessagingSettings {
  /** From tenants.messaging_live_at (FR-MIG-19). */
  liveAt: string | null;
  tenDlc: { legalName: string; ein: string; website: string; contactEmail: string; useCase: string; status: "not_started" | "details_saved" } | null;
}

export async function messagingSettings(m: MemberSession): Promise<MessagingSettings & { emailProvider: "log" | "resend" | null; imported: number }> {
  return withRls(m.claims, async (tx) => {
    const t = await tx.selectFrom("tenants").select(["settings", "messaging_live_at"]).executeTakeFirstOrThrow();
    const s = ((t.settings ?? {}) as { messaging?: Partial<MessagingSettings> }).messaging ?? {};
    const imported = await tx.selectFrom("customers").select(sql<number>`count(*)::int`.as("n")).where("import_job_id", "is not", null).executeTakeFirstOrThrow();
    return { liveAt: t.messaging_live_at?.toISOString() ?? null, tenDlc: s.tenDlc ?? null, emailProvider: emailProvider(), imported: imported.n };
  });
}

async function patchMessaging(m: MemberSession, patch: Partial<MessagingSettings>) {
  await withRls(m.claims, async (tx) => {
    await tx
      .updateTable("tenants")
      .set({ settings: sql`jsonb_set(settings, '{messaging}', coalesce(settings -> 'messaging', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)` })
      .where("id", "=", m.tenantId)
      .execute();
  });
}

/** FR-MIG-19: imported customers start getting messages from now on. */
export async function goLive(m: MemberSession) {
  await withRls(m.claims, (tx) => sql`select app.go_live()`.execute(tx));
}

export function saveTenDlc(m: MemberSession, details: Omit<NonNullable<MessagingSettings["tenDlc"]>, "status">) {
  return patchMessaging(m, { tenDlc: { ...details, status: "details_saved" } });
}

export async function recentMessages(m: MemberSession, opts: { customerId?: string; limit?: number } = {}) {
  return withRls(m.claims, async (tx) => {
    let q = tx
      .selectFrom("messages as msg")
      .leftJoin("customers as c", (j) => j.onRef("c.id", "=", "msg.customer_id").onRef("c.tenant_id", "=", "msg.tenant_id"))
      .select(["msg.id", "msg.template", "msg.channel", "msg.recipient", "msg.status", "msg.suppressed_reason", "msg.error", "msg.created_at", "c.display_name", "c.id as customer_id"])
      .orderBy("msg.created_at", "desc")
      .limit(opts.limit ?? 50);
    if (opts.customerId) q = q.where("msg.customer_id", "=", opts.customerId);
    return q.execute();
  });
}

export async function serviceRequests(m: MemberSession, opts: { customerId?: string; open?: boolean } = {}) {
  return withRls(m.claims, async (tx) => {
    let q = tx
      .selectFrom("service_requests as r")
      .innerJoin("customers as c", (j) => j.onRef("c.id", "=", "r.customer_id").onRef("c.tenant_id", "=", "r.tenant_id"))
      .select(["r.id", "r.message", "r.preferred_times", "r.status", "r.created_at", "c.id as customer_id", "c.display_name", "c.phone"])
      .orderBy("r.created_at", "desc")
      .limit(50);
    if (opts.customerId) q = q.where("r.customer_id", "=", opts.customerId);
    if (opts.open) q = q.where("r.status", "=", "open");
    return q.execute();
  });
}

export async function markRequestDone(m: MemberSession, id: string) {
  await withRls(m.claims, (tx) => tx.updateTable("service_requests").set({ status: "done", handled_by: m.userId, handled_at: new Date() }).where("id", "=", id).where("status", "=", "open").execute());
}

export const TEMPLATE_LABEL: Record<string, string> = {
  appointment_reminder: "Visit reminder",
  appointment_completed: "Service complete",
  invoice_issued: "Invoice",
  portal_sign_in: "Sign-in link",
};
