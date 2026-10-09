import "server-only";
import { sql } from "kysely";
import type { DeveloperSession } from "@/lib/auth/session";
import { withOperator } from "@/lib/db/operator";
import type { OpsHealth, OpsTenant, ProductError, ProductSummary } from "./console-model";

// OPS-01: everything the developer console reads, through the app.ops_*
// functions only. OPS-02: the view is recorded first, in its own transaction,
// so it is on the audit even if a read below fails.

export interface OpsError {
  at: string;
  source: string;
  kind: string;
  tenantId: string | null;
  tenantName: string | null;
  error: string;
}

export interface OpsAuditEntry {
  at: string;
  actorEmail: string;
  action: string;
  targetTenantId: string | null;
}

export interface ConsoleData {
  tenants: OpsTenant[];
  health: OpsHealth;
  errors: OpsError[];
  audit: OpsAuditEntry[];
  /** OPS-03: product events over 30 days, errors grouped over 7. */
  product: ProductSummary;
  productErrors: ProductError[];
}

const iso = (v: Date | string | null): string | null => (v === null ? null : v instanceof Date ? v.toISOString() : v);

/** OPS-02: one line on the operator audit for a developer action. */
export async function recordOperatorAction(dev: DeveloperSession, action: string, targetTenantId: string | null = null, details: Record<string, unknown> = {}): Promise<void> {
  await withOperator(dev, (tx) => sql`select app.ops_record(${action}, ${targetTenantId}::uuid, ${JSON.stringify(details)}::jsonb)`.execute(tx));
}

export async function loadConsole(dev: DeveloperSession): Promise<ConsoleData> {
  await recordOperatorAction(dev, "console.view");
  return withOperator(dev, async (tx) => {
    const tenants = await sql<{
      tenant_id: string;
      name: string;
      plan: string;
      state: string;
      created_at: Date;
      members: number;
      active_customers: number;
      visits_completed_30d: number;
      stripe_charges_enabled: boolean;
      white_label: boolean;
      messaging_live: boolean;
      open_reconciliation: number;
      stuck_payments: number;
      failed_payments_7d: number;
      failed_messages_7d: number;
      open_sync_conflicts: number;
      last_billing_run: Date | null;
    }>`select * from app.ops_tenants()`.execute(tx);
    const health = await sql<{ h: OpsHealth }>`select app.ops_health() as h`.execute(tx);
    const errors = await sql<{ at: Date; source: string; kind: string; tenant_id: string | null; tenant_name: string | null; error: string }>`
      select * from app.ops_recent_errors(50)`.execute(tx);
    const audit = await sql<{ at: Date; actor_email: string; action: string; target_tenant_id: string | null }>`
      select at, actor_email, action, target_tenant_id from app.ops_audit_recent(25)`.execute(tx);
    // OPS-03: counts and scrubbed error text only; business names come back
    // only for rows whose business chose to share as identified (OPS-04).
    const product = await sql<{ s: ProductSummary }>`select app.ops_product_summary(30) as s`.execute(tx);
    const productErrors = await sql<{
      fingerprint: string;
      name: string;
      surface: string;
      kind: string | null;
      route: string | null;
      message: string | null;
      occurrences: number;
      first_hour: Date;
      last_hour: Date;
      versions: string[] | null;
      businesses: string[] | null;
    }>`select * from app.ops_product_errors(7, 50)`.execute(tx);
    return {
      tenants: tenants.rows.map((r) => ({
        tenantId: r.tenant_id,
        name: r.name,
        plan: r.plan,
        state: r.state,
        createdAt: iso(r.created_at)!,
        members: r.members,
        activeCustomers: r.active_customers,
        visitsCompleted30d: r.visits_completed_30d,
        stripeChargesEnabled: r.stripe_charges_enabled,
        whiteLabel: r.white_label,
        messagingLive: r.messaging_live,
        openReconciliation: r.open_reconciliation,
        stuckPayments: r.stuck_payments,
        failedPayments7d: r.failed_payments_7d,
        failedMessages7d: r.failed_messages_7d,
        openSyncConflicts: r.open_sync_conflicts,
        lastBillingRun: iso(r.last_billing_run),
      })),
      health: health.rows[0]!.h,
      errors: errors.rows.map((r) => ({ at: iso(r.at)!, source: r.source, kind: r.kind, tenantId: r.tenant_id, tenantName: r.tenant_name, error: r.error })),
      audit: audit.rows.map((r) => ({ at: iso(r.at)!, actorEmail: r.actor_email, action: r.action, targetTenantId: r.target_tenant_id })),
      product: product.rows[0]!.s,
      productErrors: productErrors.rows.map((r) => ({
        fingerprint: r.fingerprint,
        name: r.name,
        surface: r.surface,
        kind: r.kind,
        route: r.route,
        message: r.message,
        occurrences: r.occurrences,
        firstHour: iso(r.first_hour)!,
        lastHour: iso(r.last_hour)!,
        versions: r.versions ?? [],
        businesses: r.businesses ?? [],
      })),
    };
  });
}
