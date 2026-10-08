import { CheckCircle, WarningCircle, XCircle } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { sql } from "kysely";
import { withAnon } from "@/lib/db/rls";

export const metadata: Metadata = { title: "Status" };
export const dynamic = "force-dynamic";

type Health = "ok" | "slow" | "down";

async function status() {
  try {
    const r = await withAnon((tx) =>
      sql<{ outbox_waiting: number; outbox_oldest_minutes: number; messages_failed_24h: number; billing_last_finished: Date | null; billing_failures_24h: number }>`select * from app.system_status()`.execute(tx),
    );
    return r.rows[0] ?? null;
  } catch {
    return null;
  }
}

const ICON = { ok: CheckCircle, slow: WarningCircle, down: XCircle };
const TONE = { ok: "text-success", slow: "text-warning", down: "text-danger" };
const WORD = { ok: "Working", slow: "Delayed", down: "Down" };

// NFR-04: a public, plain status page. Aggregates only.
export default async function StatusPage() {
  const s = await status();
  const rows: { name: string; health: Health; detail: string }[] = s
    ? [
        { name: "App and database", health: "ok", detail: "Responding." },
        {
          name: "Email",
          health: s.outbox_oldest_minutes > 30 ? "slow" : "ok",
          detail: s.outbox_waiting ? `${s.outbox_waiting} waiting, oldest ${s.outbox_oldest_minutes} min.` : "Nothing waiting.",
        },
        {
          name: "Billing runs",
          health: s.billing_failures_24h > 0 ? "slow" : "ok",
          detail: s.billing_failures_24h ? `${s.billing_failures_24h} items need a retry from the last day.` : s.billing_last_finished ? "Last run finished normally." : "No runs yet.",
        },
      ]
    : [{ name: "App and database", health: "down", detail: "Not responding. The technician app keeps working offline and uploads when this is back." }];
  const worst: Health = rows.some((r) => r.health === "down") ? "down" : rows.some((r) => r.health === "slow") ? "slow" : "ok";
  return (
    <div className="grid gap-8">
      <h1 className="text-3xl font-semibold tracking-tight">Status</h1>
      <p className={`text-xl font-semibold ${TONE[worst]}`}>{worst === "ok" ? "Everything is working." : worst === "slow" ? "Some things are slower than usual." : "Something is down."}</p>
      <ul className="grid divide-y divide-line rounded-panel border border-line bg-surface">
        {rows.map((r) => {
          const Icon = ICON[r.health];
          return (
            <li key={r.name} className="flex items-start gap-3 px-5 py-4">
              <Icon size={22} weight="fill" className={`mt-0.5 shrink-0 ${TONE[r.health]}`} aria-hidden />
              <div className="grid gap-0.5">
                <p className="font-medium">
                  {r.name}: {WORD[r.health]}
                </p>
                <p className="text-sm text-fg-muted">{r.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-fg-muted">Checked {new Date().toUTCString()}.</p>
    </div>
  );
}
