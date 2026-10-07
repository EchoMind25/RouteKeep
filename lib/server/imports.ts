import "server-only";
import { sql } from "kysely";
import type { MemberSession } from "@/lib/auth/session";
import { toCsv } from "@/lib/csv";
import { withRls, type Tx } from "@/lib/db/rls";
import { parseRule } from "@/lib/domain/recurrence";
import { todayIn } from "@/lib/domain/time";
import { autoMap, checkRow, FIELDS, headerSignature, type ColumnMap, type NormalizedRow, type PlanRef } from "@/lib/import/customers";
import { parseCsv } from "@/lib/import/parse";
import { geocoder } from "@/lib/server/geocoding";
import { generateVisits } from "@/lib/server/generation";

// PRD section 9: the import wizard for customer lists. Upload stages every
// row (FR-MIG-08); the owner checks the column matches (FR-MIG-09); checking
// sorts every row into create, update, skip or fix, with reasons (FR-MIG-10);
// the dry run totals what would happen (FR-MIG-11); commit runs in short
// steps and is idempotent on (tenant, source, external_ref) (FR-MIG-12);
// reconcile compares the file's totals with what landed (FR-MIG-13).
// Everything runs as the signed-in owner or admin, under RLS.

export type ImportSource = "csv" | "routekeep" | "fieldroutes";
export const COMMIT_BATCH = 50;
const ROLLBACK_DAYS = 7;

export class ImportError extends Error {}

interface JobStats {
  headers: string[];
  sample: string[][];
  columnMap: ColumnMap;
  rows: number;
  presetName?: string | null;
}

export interface DryRun {
  create: number;
  update: number;
  unchanged: number;
  invalid: number;
  duplicate: number;
  subscriptions: number;
  monthlyCents: number;
  openCents: number;
  warnings: number;
}

export interface Reconcile {
  rows: { label: string; file: number; imported: number; money?: boolean }[];
  matches: boolean;
}

// Our own export's customers.csv, recognised so it re-imports without mapping (FR-EXP-03).
const ROUTEKEEP_MAP: ColumnMap = {
  external_ref: "id",
  first_name: "first_name",
  last_name: "last_name",
  company_name: "company_name",
  full_name: "display_name",
  email: "email",
  phone: "phone",
  alt_phone: "alt_phone",
  address_line1: "service_address_line1",
  address_line2: "service_address_line2",
  city: "service_city",
  region: "service_region",
  postal_code: "service_postal_code",
  access_notes: "access_notes",
  notes: "notes",
  plan_name: "plan_name",
  plan_price: "plan_price",
  next_service: "next_service",
  balance: "balance",
  status: "status",
};

export async function startImport(m: MemberSession, file: { name: string; text: string }): Promise<string> {
  const sheet = parseCsv(file.text);
  if (sheet.rows.length === 0) throw new ImportError("The file has headers but no rows.");
  return withRls(m.claims, async (tx) => {
    const isOurs = ["id", "display_name", "service_address_line1", "service_postal_code"].every((h) => sheet.headers.includes(h));
    const signature = headerSignature(sheet.headers);
    const preset = isOurs
      ? null
      : await tx
          .selectFrom("import_mappings")
          .select(["name", "source", "column_map"])
          .where("entity", "=", "customers")
          .where(sql<boolean>`header_signature = ${signature}::text[]`)
          .orderBy("is_preset", "desc")
          .executeTakeFirst();
    const source: ImportSource = isOurs ? "routekeep" : ((preset?.source as ImportSource | undefined) ?? "csv");
    const columnMap = isOurs ? ROUTEKEEP_MAP : ((preset?.column_map as ColumnMap | undefined) ?? autoMap(sheet.headers, sheet.rows.slice(0, 25)));
    const stats: JobStats = { headers: sheet.headers, sample: sheet.rows.slice(0, 5), columnMap, rows: sheet.rows.length, presetName: isOurs ? `${"RouteKeep"} export` : (preset?.name ?? null) };
    const job = await tx
      .insertInto("import_jobs")
      .values({ source, files: JSON.stringify([{ name: file.name.slice(0, 200), rows: sheet.rows.length }]), stats: JSON.stringify(stats) })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (let k = 0; k < sheet.rows.length; k += 500) {
      await tx
        .insertInto("import_rows")
        .values(
          sheet.rows.slice(k, k + 500).map((r, i) => ({
            job_id: job.id,
            entity: "customers",
            file_name: file.name.slice(0, 200),
            row_number: k + i + 1,
            raw: JSON.stringify(Object.fromEntries(sheet.headers.map((h, c) => [h, r[c] ?? ""]))),
          })),
        )
        .execute();
    }
    return job.id;
  });
}

export async function listImports(m: MemberSession) {
  return withRls(m.claims, (tx) =>
    tx.selectFrom("import_jobs").select(["id", "source", "status", "files", "created_at", "committed_at", "rollback_deadline"]).orderBy("created_at", "desc").limit(50).execute(),
  );
}

async function plans(tx: Tx): Promise<(PlanRef & { rrule: string; serviceTypeId: string; billingMode: string; duration: number | null; initialCents: number | null })[]> {
  const rows = await tx
    .selectFrom("service_plans")
    .select(["id", "name", "price_cents", "rrule", "service_type_id", "billing_mode", "default_duration_min", "initial_price_cents"])
    .where("active", "=", true)
    .execute();
  return rows.map((p) => ({ id: p.id, name: p.name, priceCents: p.price_cents, rrule: p.rrule, serviceTypeId: p.service_type_id, billingMode: p.billing_mode, duration: p.default_duration_min, initialCents: p.initial_price_cents }));
}

export async function getImport(m: MemberSession, id: string) {
  return withRls(m.claims, async (tx) => {
    const job = await tx.selectFrom("import_jobs").selectAll().where("id", "=", id).executeTakeFirst();
    if (!job) return null;
    const counts = await tx
      .selectFrom("import_rows")
      .select(["status", sql<number>`count(*)::int`.as("n")])
      .where("job_id", "=", id)
      .groupBy("status")
      .execute();
    const problems = await tx
      .selectFrom("import_rows")
      .select(["row_number", "status", "reasons", "raw"])
      .where("job_id", "=", id)
      .where("status", "in", ["invalid", "duplicate"])
      .orderBy("row_number")
      .limit(20)
      .execute();
    return {
      job: { ...job, stats: job.stats as unknown as JobStats, dryRun: job.dry_run_report as DryRun | null, reconcile: job.reconcile_report as Reconcile | null },
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>,
      problems,
      plans: (await plans(tx)).map((p) => p.name),
    };
  });
}

export async function saveMapping(m: MemberSession, id: string, columnMap: ColumnMap, presetName: string | null) {
  return withRls(m.claims, async (tx) => {
    const job = await tx.selectFrom("import_jobs").select(["status", "stats", "source"]).where("id", "=", id).forUpdate().executeTakeFirstOrThrow();
    if (!["uploaded", "mapped", "validated"].includes(job.status)) throw new ImportError("This import is already being committed.");
    const stats = job.stats as unknown as JobStats;
    const known = new Set(stats.headers);
    const clean: ColumnMap = {};
    for (const f of FIELDS) {
      const h = columnMap[f.key];
      if (h && known.has(h)) clean[f.key] = h;
    }
    await tx.updateTable("import_jobs").set({ status: "mapped", stats: JSON.stringify({ ...stats, columnMap: clean }), dry_run_report: null }).where("id", "=", id).execute();
    // FR-MIG-09: a mapping can be kept for the next file with the same columns.
    if (presetName) {
      await tx
        .insertInto("import_mappings")
        .values({ name: presetName.slice(0, 120), source: job.source, entity: "customers", column_map: JSON.stringify(clean), header_signature: headerSignature(stats.headers) })
        .execute();
    }
  });
}

function visitsPerMonth(rrule: string): number {
  try {
    const rule = parseRule(rrule);
    const every = rule.interval ?? 1;
    const perMonth = { DAILY: 30.44, WEEKLY: 4.35, MONTHLY: 1, YEARLY: 1 / 12 }[rule.freq];
    return perMonth / every;
  } catch {
    return 0;
  }
}

/** FR-MIG-10, FR-MIG-11: sort every row and total what a commit would do. */
export async function checkImport(m: MemberSession, id: string): Promise<DryRun> {
  return withRls(m.claims, async (tx) => {
    const job = await tx.selectFrom("import_jobs").select(["status", "stats", "source"]).where("id", "=", id).forUpdate().executeTakeFirstOrThrow();
    if (!["uploaded", "mapped", "validated"].includes(job.status)) throw new ImportError("This import is already being committed.");
    const stats = job.stats as unknown as JobStats;
    const planList = await plans(tx);
    const planById = new Map(planList.map((p) => [p.id, p]));
    const rows = await tx.selectFrom("import_rows").select(["id", "raw"]).where("job_id", "=", id).orderBy("row_number").execute();
    const existing = new Map(
      (
        await tx
          .selectFrom("customers")
          .select(["id", "external_ref", "email", "phone", "notes", "display_name"])
          .where("source", "=", job.source)
          .where("external_ref", "is not", null)
          .execute()
      ).map((c) => [c.external_ref!, c]),
    );
    const emails = new Map(
      (await tx.selectFrom("customers").select(["email", "display_name"]).where("email", "is not", null).execute()).map((c) => [c.email!, c.display_name]),
    );
    const report: DryRun = { create: 0, update: 0, unchanged: 0, invalid: 0, duplicate: 0, subscriptions: 0, monthlyCents: 0, openCents: 0, warnings: 0 };
    const seen = new Set<string>();
    const updates: { id: string; status: string; action: string | null; reasons: string[]; mapped: NormalizedRow | null; external_ref: string | null }[] = [];
    for (const r of rows) {
      const check = checkRow(r.raw as Record<string, string>, stats.columnMap, planList);
      if (!check.ok) {
        report.invalid += 1;
        updates.push({ id: r.id, status: "invalid", action: null, reasons: check.reasons, mapped: null, external_ref: null });
        continue;
      }
      const row = check.row;
      if (seen.has(row.externalRef)) {
        report.duplicate += 1;
        updates.push({ id: r.id, status: "duplicate", action: "skip", reasons: ["Same customer appears earlier in this file"], mapped: row, external_ref: row.externalRef });
        continue;
      }
      seen.add(row.externalRef);
      const before = existing.get(row.externalRef);
      if (!before && row.email && emails.has(row.email)) {
        report.duplicate += 1;
        updates.push({ id: r.id, status: "duplicate", action: "skip", reasons: [`Same email as ${emails.get(row.email)}, already a customer`], mapped: row, external_ref: row.externalRef });
        continue;
      }
      report.warnings += check.warnings.length;
      if (before) {
        // FR-MIG-16: a later export updates contact details; nothing else is overwritten.
        const changed = before.email !== row.email || before.phone !== row.phone || (before.notes ?? null) !== row.notes || before.display_name !== row.displayName;
        if (changed) report.update += 1;
        else report.unchanged += 1;
        updates.push({ id: r.id, status: changed ? "valid" : "skipped", action: changed ? "update" : "skip", reasons: changed ? check.warnings : ["Already imported, nothing changed"], mapped: row, external_ref: row.externalRef });
        continue;
      }
      report.create += 1;
      if (row.planId) {
        const plan = planById.get(row.planId)!;
        report.subscriptions += 1;
        report.monthlyCents += Math.round((row.priceCents ?? plan.priceCents) * visitsPerMonth(plan.rrule));
      }
      if (row.balanceCents > 0) report.openCents += row.balanceCents;
      updates.push({ id: r.id, status: "valid", action: "create", reasons: check.warnings, mapped: row, external_ref: row.externalRef });
    }
    for (let k = 0; k < updates.length; k += 500) {
      await sql`
        update public.import_rows r
        set status = v.status, action = v.action, reasons = v.reasons, mapped = v.mapped, external_ref = v.external_ref, updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(updates.slice(k, k + 500))}::jsonb)
          as v(id uuid, status text, action text, reasons text[], mapped jsonb, external_ref text)
        where r.id = v.id and r.job_id = ${id}::uuid`.execute(tx);
    }
    await tx.updateTable("import_jobs").set({ status: "validated", dry_run_report: JSON.stringify(report) }).where("id", "=", id).execute();
    return report;
  });
}

/** FR-MIG-11: only the rows that need fixing, with a reason column, ready to fix and upload again. */
export async function problemRowsCsv(m: MemberSession, id: string): Promise<string> {
  return withRls(m.claims, async (tx) => {
    const job = await tx.selectFrom("import_jobs").select("stats").where("id", "=", id).executeTakeFirstOrThrow();
    const headers = (job.stats as unknown as JobStats).headers;
    const rows = await tx.selectFrom("import_rows").select(["raw", "reasons"]).where("job_id", "=", id).where("status", "=", "invalid").orderBy("row_number").execute();
    return toCsv([[...headers, "What to fix"], ...rows.map((r) => [...headers.map((h) => (r.raw as Record<string, string>)[h] ?? ""), r.reasons.join("; ")])]);
  });
}

export interface CommitProgress {
  done: number;
  left: number;
  finished: boolean;
}

/** FR-MIG-12: one short step of the commit. Call until `finished`. */
export async function commitStep(m: MemberSession, id: string): Promise<CommitProgress> {
  // Geocode outside the transaction: a slow provider must not hold a connection.
  const pending = await withRls(m.claims, async (tx) => {
    const job = await tx.selectFrom("import_jobs").select(["status"]).where("id", "=", id).executeTakeFirstOrThrow();
    if (!["validated", "committing"].includes(job.status)) throw new ImportError("Check the file before importing it.");
    return tx
      .selectFrom("import_rows")
      .select(["id", "mapped", "action"])
      .where("job_id", "=", id)
      .where("status", "=", "valid")
      .where("action", "in", ["create", "update"])
      .orderBy("row_number")
      .limit(COMMIT_BATCH)
      .execute();
  });
  const geo = new Map<string, Awaited<ReturnType<ReturnType<typeof geocoder>["geocode"]>>>();
  for (const r of pending) {
    if (r.action !== "create") continue;
    const row = r.mapped as unknown as NormalizedRow;
    geo.set(r.id, await geocoder().geocode({ line1: row.line1, city: row.city, region: row.region, postalCode: row.postalCode }).catch(() => null));
  }

  return withRls(m.claims, async (tx) => {
    const job = await tx.selectFrom("import_jobs").select(["status", "source"]).where("id", "=", id).forUpdate().executeTakeFirstOrThrow();
    if (!["validated", "committing"].includes(job.status)) throw new ImportError("Check the file before importing it.");
    if (job.status === "validated") await tx.updateTable("import_jobs").set({ status: "committing" }).where("id", "=", id).execute();
    const tenant = await tx.selectFrom("tenants").select(["id", "timezone"]).executeTakeFirstOrThrow();
    const today = todayIn(tenant.timezone);
    const planById = new Map((await plans(tx)).map((p) => [p.id, p]));
    const now = new Date();
    const subscriptionIds: string[] = [];
    // Re-read under the lock: another tab may have taken some of these rows.
    const rows = await tx
      .selectFrom("import_rows")
      .select(["id", "mapped", "action"])
      .where("id", "in", pending.length ? pending.map((p) => p.id) : ["00000000-0000-0000-0000-000000000000"])
      .where("status", "=", "valid")
      .execute();
    for (const r of rows) {
      const row = r.mapped as unknown as NormalizedRow;
      let targetId: string;
      if (r.action === "update") {
        const c = await tx
          .updateTable("customers")
          .set({ email: row.email, phone: row.phone, alt_phone: row.altPhone, notes: row.notes, display_name: row.displayName, first_name: row.firstName, last_name: row.lastName, company_name: row.companyName })
          .where("source", "=", job.source)
          .where("external_ref", "=", row.externalRef)
          .returning("id")
          .executeTakeFirstOrThrow();
        targetId = c.id;
      } else {
        const g = geo.get(r.id) ?? null;
        const customer = await tx
          .insertInto("customers")
          .values({
            kind: row.kind,
            first_name: row.firstName,
            last_name: row.lastName,
            company_name: row.companyName,
            display_name: row.displayName,
            email: row.email,
            phone: row.phone,
            alt_phone: row.altPhone,
            notes: row.notes,
            status: row.active ? "active" : "inactive",
            source: job.source,
            external_ref: row.externalRef,
            import_job_id: id,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        targetId = customer.id;
        const property = await tx
          .insertInto("properties")
          .values({
            customer_id: customer.id,
            address_line1: row.line1,
            address_line2: row.line2,
            city: row.city,
            region: row.region,
            postal_code: row.postalCode,
            access_notes: row.accessNotes,
            location: g ? sql`extensions.st_setsrid(extensions.st_makepoint(${g.lng}, ${g.lat}), 4326)::extensions.geography` : null,
            geocode_confidence: g ? String(g.confidence) : null,
            geocode_source: g?.source ?? null,
            geocoded_at: g ? now : null,
            source: job.source,
            external_ref: row.externalRef,
            import_job_id: id,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const plan = row.planId ? planById.get(row.planId) : undefined;
        if (plan) {
          const start = row.nextService && row.nextService >= today ? row.nextService : today;
          const sub = await tx
            .insertInto("subscriptions")
            .values({
              customer_id: customer.id,
              property_id: property.id,
              plan_id: plan.id,
              service_type_id: plan.serviceTypeId,
              start_date: start,
              rrule: plan.rrule,
              price_cents: row.priceCents ?? plan.priceCents,
              // An existing customer has had their first service already.
              initial_price_cents: null,
              billing_mode: plan.billingMode,
              duration_min: plan.duration ?? 30,
              source: job.source,
              external_ref: row.externalRef,
              import_job_id: id,
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          subscriptionIds.push(sub.id);
        }
        // FR-MIG-06: what they owe today, as one opening entry.
        if (row.balanceCents !== 0) {
          await tx
            .insertInto("ledger_entries")
            .values({ customer_id: customer.id, type: "opening_balance", amount_cents: row.balanceCents, entry_key: `opening:${id}:${row.externalRef}`.slice(0, 200), occurred_at: now, source: job.source, import_job_id: id })
            .execute();
        }
      }
      await tx.updateTable("import_rows").set({ status: "committed", target_id: targetId }).where("id", "=", r.id).execute();
    }
    if (subscriptionIds.length) await generateVisits(tx, tenant.id, { subscriptionIds });

    const left = await tx
      .selectFrom("import_rows")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("job_id", "=", id)
      .where("status", "=", "valid")
      .where("action", "in", ["create", "update"])
      .executeTakeFirstOrThrow();
    const done = await tx.selectFrom("import_rows").select(sql<number>`count(*)::int`.as("n")).where("job_id", "=", id).where("status", "=", "committed").executeTakeFirstOrThrow();
    if (left.n === 0) {
      await tx
        .updateTable("import_jobs")
        .set({ status: "committed", committed_at: now, rollback_deadline: new Date(now.getTime() + ROLLBACK_DAYS * 86_400_000) })
        .where("id", "=", id)
        .execute();
      await reconcile(tx, id);
    }
    return { done: done.n, left: left.n, finished: left.n === 0 };
  });
}

/** FR-MIG-13: the file's totals beside what is now in the database. */
async function reconcile(tx: Tx, id: string): Promise<Reconcile> {
  const planned = await tx
    .selectFrom("import_rows")
    .select([
      sql<number>`count(*) filter (where action = 'create')::int`.as("customers"),
      sql<number>`count(*) filter (where action = 'create' and mapped->>'planId' is not null)::int`.as("subscriptions"),
      sql<number>`coalesce(sum((mapped->>'balanceCents')::int) filter (where action = 'create'), 0)::int`.as("balance"),
    ])
    .where("job_id", "=", id)
    .where("status", "=", "committed")
    .executeTakeFirstOrThrow();
  const count = async (table: "customers" | "properties" | "subscriptions") =>
    (await tx.selectFrom(table).select(sql<number>`count(*)::int`.as("n")).where("import_job_id", "=", id).executeTakeFirstOrThrow()).n;
  const balance = (await tx.selectFrom("ledger_entries").select(sql<number>`coalesce(sum(amount_cents), 0)::int`.as("n")).where("import_job_id", "=", id).executeTakeFirstOrThrow()).n;
  const rows = [
    { label: "Customers", file: planned.customers, imported: await count("customers") },
    { label: "Service addresses", file: planned.customers, imported: await count("properties") },
    { label: "Active plans", file: planned.subscriptions, imported: await count("subscriptions") },
    { label: "Opening balances", file: planned.balance, imported: balance, money: true },
  ];
  const report = { rows, matches: rows.every((r) => r.file === r.imported) };
  await tx.updateTable("import_jobs").set({ status: "reconciled", reconcile_report: JSON.stringify(report) }).where("id", "=", id).execute();
  return report;
}
