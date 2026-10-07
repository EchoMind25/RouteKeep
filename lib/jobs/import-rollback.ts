import "server-only";
import { sql } from "kysely";
import { withServiceRole } from "@/lib/db/service";

// FR-MIG-14: undo an import within 7 days. A customer the import created is
// removed with everything the import made for it, unless the business has
// since worked with it (a visit started or finished, a record, an invoice or a
// payment); those stay and are listed. Contact details an import updated on
// existing customers are not reverted (they were real updates from the file).
// Runs with the service role because deletes of append-only rows (opening
// balances) are allowed only to the rollback, for this import's own rows.

export interface RollbackResult {
  removed: number;
  kept: { id: string; name: string; why: string }[];
}

export class RollbackRefused extends Error {}

export async function rollbackImport(tenantId: string, jobId: string, now = new Date()): Promise<RollbackResult> {
  return withServiceRole(async (tx) => {
    const job = await tx
      .selectFrom("import_jobs")
      .select(["status", "rollback_deadline"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", jobId)
      .forUpdate()
      .executeTakeFirst();
    if (!job) throw new RollbackRefused("That import was not found.");
    if (!["committed", "reconciled"].includes(job.status)) throw new RollbackRefused("Only a finished import can be undone.");
    if (!job.rollback_deadline || job.rollback_deadline < now) throw new RollbackRefused("The 7 days to undo this import have passed.");
    await sql`select set_config('app.rollback_import_job_id', ${jobId}, true)`.execute(tx);

    const customers = await tx.selectFrom("customers").select(["id", "display_name"]).where("tenant_id", "=", tenantId).where("import_job_id", "=", jobId).execute();
    const ids = customers.map((c) => c.id);
    if (!ids.length) {
      await tx.updateTable("import_jobs").set({ status: "rolled_back", rolled_back_at: now }).where("tenant_id", "=", tenantId).where("id", "=", jobId).execute();
      return { removed: 0, kept: [] };
    }
    const touched = new Map<string, string>();
    const mark = (rows: { customer_id: string }[], why: string) => rows.forEach((r) => touched.has(r.customer_id) || touched.set(r.customer_id, why));
    mark(
      await tx.selectFrom("appointments").select("customer_id").where("tenant_id", "=", tenantId).where("customer_id", "in", ids).where("status", "in", ["in_progress", "completed"]).execute(),
      "a visit was started or finished",
    );
    mark(await tx.selectFrom("invoices").select("customer_id").where("tenant_id", "=", tenantId).where("customer_id", "in", ids).execute(), "it has an invoice");
    mark(await tx.selectFrom("payments").select("customer_id").where("tenant_id", "=", tenantId).where("customer_id", "in", ids).execute(), "it has a payment");
    mark(
      await tx
        .selectFrom("ledger_entries")
        .select("customer_id")
        .where("tenant_id", "=", tenantId)
        .where("customer_id", "in", ids)
        .where((eb) => eb.or([eb("import_job_id", "is", null), eb("import_job_id", "!=", jobId)]))
        .execute(),
      "money was recorded for it",
    );
    const remove = ids.filter((id) => !touched.has(id));

    if (remove.length) {
      await tx.deleteFrom("appointments").where("tenant_id", "=", tenantId).where("customer_id", "in", remove).execute();
      await tx.deleteFrom("subscriptions").where("tenant_id", "=", tenantId).where("customer_id", "in", remove).execute();
      await sql`select app.rollback_import_ledger(${tenantId}::uuid, ${jobId}::uuid, ${remove}::uuid[])`.execute(tx);
      await tx.deleteFrom("properties").where("tenant_id", "=", tenantId).where("customer_id", "in", remove).execute();
      await tx.deleteFrom("customers").where("tenant_id", "=", tenantId).where("id", "in", remove).execute();
      await tx
        .updateTable("import_rows")
        .set({ status: "rolled_back" })
        .where("tenant_id", "=", tenantId)
        .where("job_id", "=", jobId)
        .where("target_id", "in", remove)
        .where("action", "=", "create")
        .execute();
    }
    await tx
      .updateTable("import_jobs")
      .set({ status: touched.size ? "reconciled" : "rolled_back", rolled_back_at: now, stats: sql`stats || ${JSON.stringify({ rollback: { removed: remove.length, kept: touched.size } })}::jsonb` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", jobId)
      .execute();
    return { removed: remove.length, kept: customers.filter((c) => touched.has(c.id)).map((c) => ({ id: c.id, name: c.display_name, why: touched.get(c.id)! })) };
  });
}
