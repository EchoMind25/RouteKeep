import "server-only";
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { sql } from "kysely";
import type { MemberSession } from "@/lib/auth/session";
import { BRAND } from "@/lib/brand";
import { toCsv, type Cell } from "@/lib/csv";
import { withRls, type Tx } from "@/lib/db/rls";
import { addDays, todayIn, type LocalDate } from "@/lib/domain/time";
import { storage } from "@/lib/providers/storage";
import { renderUsageReport } from "@/lib/reports/product-usage-pdf";
import { productUsage } from "@/lib/server/reports";

// FR-EXP-01..03: the owner can take everything, any time. One ZIP:
//   tables/<table>.csv and .json  every row the business owns, every column
//   customers-import.csv          customers in the shape our import reads (FR-EXP-03)
//   records/<YYYY-MM>[-partNN-of-MM].pdf  every application record, by month, 200 per PDF
//   attachments/...               photos, signatures and documents as stored
//   manifest.json, README.txt     what is where (docs/EXPORT_FORMAT.md)
// Built in short steps (D-04), one part per request; parts are kept in
// storage until the last step assembles them. The link expires after 7 days
// (FR-EXP-02). Runs as the signed-in owner or admin, under RLS.

export const EXPORT_FORMAT_VERSION = "1";
const LINK_DAYS = 7;
const ATTACHMENTS_PER_PART = 100;
const RECORDS_PER_PDF = 200;

export class ExportError extends Error {}

interface Progress {
  parts: string[];
  done: number;
  skipped?: { table: string; reason: string }[];
}

const partPath = (tenantId: string, id: string, k: number) => `${tenantId}/exports/${id}/part-${k}.zip`;
const finalPath = (tenantId: string, id: string) => `${tenantId}/exports/${id}.zip`;

export async function listExports(m: MemberSession) {
  return withRls(m.claims, (tx) =>
    tx.selectFrom("exports").select(["id", "status", "size_bytes", "expires_at", "created_at", "error", "progress"]).orderBy("created_at", "desc").limit(20).execute(),
  );
}

async function tenantTables(tx: Tx): Promise<{ table: string; geo: string[] }[]> {
  const rows = await sql<{ table_name: string; geo: string[] }>`
    select c.table_name::text as table_name,
           coalesce(array_agg(g.column_name::text order by g.column_name) filter (where g.column_name is not null), '{}')::text[] as geo
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    left join information_schema.columns g on g.table_schema = c.table_schema and g.table_name = c.table_name and g.udt_name = 'geography'
    where c.table_schema = 'public' and c.column_name = 'tenant_id'
    group by c.table_name
    order by c.table_name`.execute(tx);
  return [{ table: "tenants", geo: [] }, ...rows.rows.map((r) => ({ table: r.table_name, geo: r.geo }))];
}

/** FR-EXP-01: ask for an export. The parts are fixed now, so steps know what is left. */
export async function requestExport(m: MemberSession): Promise<string> {
  return withRls(m.claims, async (tx) => {
    const tz = (await tx.selectFrom("tenants").select("timezone").executeTakeFirstOrThrow()).timezone;
    const months = await tx
      .selectFrom("applications")
      .select([sql<string>`to_char(applied_at at time zone ${tz}, 'YYYY-MM')`.as("month"), sql<number>`count(*)::int`.as("n")])
      .where("applied_at", "is not", null)
      .groupBy(sql`1`)
      .orderBy(sql`1`)
      .execute();
    const files = (await tx.selectFrom("attachments").select(sql<number>`count(*)::int`.as("n")).executeTakeFirstOrThrow()).n;
    const parts = [
      "tables",
      "customers",
      // A records PDF takes longer than linear in its rows (200 rows about 4 s,
      // 600 about 19 s), so a month is split into parts of RECORDS_PER_PDF.
      ...months.flatMap((r) => {
        const count = Math.max(1, Math.ceil(r.n / RECORDS_PER_PDF));
        return Array.from({ length: count }, (_, k) => `records:${r.month}:${k}:${count}`);
      }),
      ...Array.from({ length: Math.ceil(files / ATTACHMENTS_PER_PART) }, (_, k) => `attachments:${k}`),
      "assemble",
    ];
    const row = await tx.insertInto("exports").values({ format_version: EXPORT_FORMAT_VERSION, progress: JSON.stringify({ parts, done: 0 }) }).returning("id").executeTakeFirstOrThrow();
    return row.id;
  });
}

function csvAndJson(name: string, rows: Record<string, unknown>[], out: Zippable) {
  const columns = rows.length ? Object.keys(rows[0]!) : [];
  const cell = (v: unknown): Cell => (v === null || v === undefined ? null : typeof v === "number" ? v : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v));
  out[`tables/${name}.csv`] = strToU8(toCsv([columns, ...rows.map((r) => columns.map((c) => cell(r[c])))]));
  out[`tables/${name}.json`] = strToU8(JSON.stringify(rows, null, 1));
}

async function buildPart(m: MemberSession, exportId: string, part: string, progress: Progress): Promise<Zippable> {
  const out: Zippable = {};
  if (part === "tables") {
    const tables = await withRls(m.claims, tenantTables);
    for (const { table, geo } of tables) {
      // One transaction per table: a table this role cannot read is noted, not fatal.
      try {
        const rows = await withRls(m.claims, async (tx) => {
          // Map points become plain _lat and _lng columns.
          const points = geo.length
            ? sql`|| jsonb_build_object(${sql.join(
                geo.flatMap((g) => [sql.lit(`${g}_lat`), sql`extensions.st_y(${sql.ref(`t.${g}`)}::extensions.geometry)`, sql.lit(`${g}_lng`), sql`extensions.st_x(${sql.ref(`t.${g}`)}::extensions.geometry)`]),
              )})`
            : sql``;
          const select = sql`select (to_jsonb(t) - ${geo}::text[]) ${points} as row from public.${sql.table(table)} t`;
          return (await sql<{ row: Record<string, unknown> }>`${select}`.execute(tx)).rows.map((r) => r.row);
        });
        csvAndJson(table, rows, out);
      } catch (error) {
        (progress.skipped ??= []).push({ table, reason: error instanceof Error ? error.message.slice(0, 160) : "unreadable" });
      }
    }
    return out;
  }

  if (part === "customers") {
    const rows = await withRls(m.claims, (tx) =>
      sql<Record<string, Cell>>`
        select c.id, c.display_name, c.first_name, c.last_name, c.company_name, c.email, c.phone, c.alt_phone,
               p.address_line1 as service_address_line1, p.address_line2 as service_address_line2, p.city as service_city,
               p.region as service_region, p.postal_code as service_postal_code, p.access_notes, c.notes,
               sp.name as plan_name, case when s.id is null then null else to_char(s.price_cents / 100.0, 'FM999999990.00') end as plan_price,
               (select min(a.local_date)::text from public.appointments a where a.subscription_id = s.id and a.status = 'scheduled') as next_service,
               to_char(coalesce(b.balance_cents, 0) / 100.0, 'FM999999990.00') as balance, c.status
        from public.customers c
        left join lateral (select * from public.properties p where p.customer_id = c.id and p.tenant_id = c.tenant_id order by p.status = 'active' desc, p.created_at limit 1) p on true
        left join lateral (select * from public.subscriptions s where s.customer_id = c.id and s.tenant_id = c.tenant_id and s.status = 'active' order by s.created_at limit 1) s on true
        left join public.service_plans sp on sp.id = s.plan_id and sp.tenant_id = s.tenant_id
        left join public.customer_balances b on b.customer_id = c.id and b.tenant_id = c.tenant_id
        order by c.display_name, c.id`.execute(tx),
    );
    const columns = ["id", "display_name", "first_name", "last_name", "company_name", "email", "phone", "alt_phone", "service_address_line1", "service_address_line2", "service_city", "service_region", "service_postal_code", "access_notes", "notes", "plan_name", "plan_price", "next_service", "balance", "status"];
    out["customers-import.csv"] = strToU8(toCsv([columns, ...rows.rows.map((r) => columns.map((c) => r[c] ?? null))]));
    return out;
  }

  if (part.startsWith("records:")) {
    const [, month, k, count] = part.split(":") as [string, string, string, string];
    const from = `${month}-01` as LocalDate;
    const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10) as LocalDate;
    const report = await productUsage(m, { from, to: addDays(next, -1), productId: null, technicianId: null }, RECORDS_PER_PDF, Number(k) * RECORDS_PER_PDF);
    // Amended records count once, so a month can come up short of its last part.
    if (report.rows.length === 0 && Number(k) > 0) return out;
    const name = Number(count) === 1 ? `records/${month}.pdf` : `records/${month}-part${String(Number(k) + 1).padStart(2, "0")}-of-${String(count).padStart(2, "0")}.pdf`;
    out[name] = new Uint8Array(await renderUsageReport({ ...report, truncated: false }));
    return out;
  }

  if (part.startsWith("attachments:")) {
    const k = Number(part.slice("attachments:".length));
    const files = await withRls(m.claims, (tx) => tx.selectFrom("attachments").select(["id", "path"]).orderBy("created_at").orderBy("id").offset(k * ATTACHMENTS_PER_PART).limit(ATTACHMENTS_PER_PART).execute());
    for (const f of files) {
      const file = await storage().get(f.path);
      // The path starts with the tenant id; the rest keeps the stored layout.
      if (file) out[`attachments/${f.path.split("/").slice(1).join("/")}`] = [file.body, { level: 0 }];
    }
    return out;
  }
  throw new ExportError(`Unknown part ${part}`);
}

export interface ExportStep {
  status: "running" | "ready";
  done: number;
  total: number;
}

/** One short step: build the next part, or assemble when all parts are built. */
export async function exportStep(m: MemberSession, exportId: string): Promise<ExportStep> {
  const row = await withRls(m.claims, (tx) => tx.selectFrom("exports").select(["status", "progress", "tenant_id"]).where("id", "=", exportId).executeTakeFirst());
  if (!row) throw new ExportError("That export was not found.");
  const progress = row.progress as unknown as Progress;
  if (row.status === "ready") return { status: "ready", done: progress.parts.length, total: progress.parts.length };
  if (!["queued", "running"].includes(row.status)) throw new ExportError("That export stopped. Start a new one.");
  const part = progress.parts[progress.done]!;
  try {
    if (part !== "assemble") {
      const files = await buildPart(m, exportId, part, progress);
      await storage().put(partPath(row.tenant_id, exportId, progress.done), zipSync(files, { level: 6 }), "application/zip");
      progress.done += 1;
      await withRls(m.claims, (tx) => tx.updateTable("exports").set({ status: "running", progress: JSON.stringify(progress) }).where("id", "=", exportId).execute());
      return { status: "running", done: progress.done, total: progress.parts.length };
    }

    const all: Zippable = {};
    for (let k = 0; k < progress.done; k++) {
      const piece = await storage().get(partPath(row.tenant_id, exportId, k));
      if (!piece) throw new ExportError("A part of this export went missing. Start a new one.");
      for (const [name, data] of Object.entries(unzipSync(piece.body))) all[name] = name.startsWith("attachments/") ? [data, { level: 0 }] : data;
    }
    const tenant = await withRls(m.claims, (tx) => tx.selectFrom("tenants").select(["name", "timezone"]).executeTakeFirstOrThrow());
    const manifest = {
      format: `${BRAND.name.toLowerCase()}-export`,
      formatVersion: EXPORT_FORMAT_VERSION,
      business: tenant.name,
      createdAt: new Date().toISOString(),
      timeZone: tenant.timezone,
      files: Object.keys(all).sort(),
      unreadableTables: progress.skipped ?? [],
    };
    all["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
    all["README.txt"] = strToU8(readme(tenant.name, todayIn(tenant.timezone)));
    const zip = zipSync(all, { level: 6 });
    await storage().put(finalPath(row.tenant_id, exportId), zip, "application/zip");
    const expires = new Date(Date.now() + LINK_DAYS * 86_400_000);
    await withRls(m.claims, (tx) =>
      tx
        .updateTable("exports")
        .set({ status: "ready", path: finalPath(row.tenant_id, exportId), size_bytes: zip.byteLength, expires_at: expires, progress: JSON.stringify({ ...progress, done: progress.parts.length }) })
        .where("id", "=", exportId)
        .execute(),
    );
    return { status: "ready", done: progress.parts.length, total: progress.parts.length };
  } catch (error) {
    await withRls(m.claims, (tx) =>
      tx.updateTable("exports").set({ status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "Export failed" }).where("id", "=", exportId).execute(),
    );
    throw error;
  }
}

/** FR-EXP-02: where the file is, while the link is valid. The route signs or streams it. */
export async function exportFile(m: MemberSession, exportId: string): Promise<{ path: string; name: string } | null> {
  const row = await withRls(m.claims, (tx) =>
    tx.selectFrom("exports").select(["status", "path", "expires_at", "created_at"]).where("id", "=", exportId).executeTakeFirst(),
  );
  if (!row || row.status !== "ready" || !row.path || !row.expires_at || row.expires_at < new Date()) return null;
  return { path: row.path, name: `${BRAND.name.toLowerCase()}-export-${row.created_at.toISOString().slice(0, 10)}.zip` };
}

function readme(business: string, day: string): string {
  return [
    `${business}: complete data export, ${day}`,
    "",
    "tables/              Every table your business has in the app, as CSV (opens in Excel or Google Sheets) and JSON.",
    "                     Money is in cents (12900 is $129.00). Times are UTC; local dates and times are as scheduled.",
    "                     Map points are split into _lat and _lng columns.",
    "customers-import.csv Your customers with their service address, plan, next service and balance, in a shape",
    "                     this app's import reads directly, so this file can start a new account.",
    "records/             Every pesticide application record by month (200 per PDF), with your business name and license.",
    "attachments/         Photos, signatures and documents, as they were stored.",
    "manifest.json        The list of files and the format version.",
    "",
    "Format: docs/EXPORT_FORMAT.md in the app's repository describes every file. Keep application records at least",
    "two years from the date of application (Utah R68-7).",
  ].join("\r\n");
}
