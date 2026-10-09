"use client";

import { CheckCircle, ClipboardText } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/layout";
import { cn } from "@/lib/cn";
import { amountLabel } from "@/lib/domain/units";
import { newKey, type TechState } from "@/lib/sync/client-store";
import { buildCountLines, type CheckEntry } from "@/lib/sync/truck-check";
import { useTech } from "./context";

// FR-INV-07: the resupply-day truck check. Works offline: submitting queues a
// stock_count mutation like any other action, and the card says where it is.

const amount = (n: number) => String(Math.round(n * 100) / 100);

export function TruckCheckCard({ state, today }: { state: TechState; today: string }) {
  const check = state.info?.truckCheck;
  const [open, setOpen] = useState(false);
  if (!check || check.date !== today) return null;
  const queued = state.outbox.some((o) => o.mutation.kind === "stock_count" && o.mutation.date === today);
  const done = !check.due || queued || state.countsDone.includes(today);

  if (done) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-panel border border-line bg-sunken p-4">
        <CheckCircle size={24} weight="bold" aria-hidden className="mt-0.5 shrink-0 text-success" />
        <div className="grid gap-0.5">
          <p className="text-md font-semibold">Truck inventory check done</p>
          <p className="text-sm text-fg-muted">{queued ? "Saved on this phone, uploads when you have signal" : "Sent to the office"}</p>
        </div>
      </div>
    );
  }

  const n = check.lines.length;
  return (
    <>
      <section aria-labelledby="truck-check-heading" className="grid gap-3 rounded-panel border-2 border-accent bg-surface p-4">
        <div className="flex items-start gap-3">
          <ClipboardText size={28} aria-hidden className="mt-0.5 shrink-0 text-accent" />
          <div className="grid gap-0.5">
            <h2 id="truck-check-heading" className="text-md font-semibold">
              Truck inventory check
            </h2>
            <p className="text-sm text-fg-muted">
              It is resupply day. Count what is on your truck: {n} {n === 1 ? "product" : "products"}.
            </p>
          </div>
        </div>
        <Button size="lg" onClick={() => setOpen(true)}>
          Start check
        </Button>
      </section>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <DialogContent title="Truck inventory check">
            <CheckForm check={check} today={today} onDone={() => setOpen(false)} />
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

function CheckForm({ check, today, onDone }: { check: NonNullable<NonNullable<TechState["info"]>["truckCheck"]>; today: string; onDone: () => void }) {
  const { store, engine } = useTech();
  const [entries, setEntries] = useState<Record<string, CheckEntry>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const patch = (id: string, change: Partial<CheckEntry>) => {
    setEntries((e) => ({ ...e, [id]: { value: "", notOnTruck: false, ...e[id], ...change } }));
    setErrors((e) => {
      const { [id]: _gone, ...rest } = e;
      return rest;
    });
  };

  async function submit() {
    const built = buildCountLines(check.lines, entries);
    setErrors(built.errors);
    if (Object.keys(built.errors).length || built.lines.length === 0) return;
    setBusy(true);
    setFailed(false);
    try {
      await store.submitCount({ kind: "stock_count", key: newKey("count"), date: today, at: new Date().toISOString(), locationId: check.locationId, lines: built.lines });
      engine.request();
      onDone();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {check.lines.length === 0 ? <Alert tone="warning">Nothing to count on your truck yet. Ask the office to add products.</Alert> : null}
      <ul className="grid max-h-[60dvh] gap-4 overflow-y-auto">
        {check.lines.map((l) => {
          const e = entries[l.productId];
          const off = e?.notOnTruck ?? false;
          return (
            <li key={l.productId} className={cn("grid gap-2 rounded-control border border-line p-3", off && "bg-sunken")}>
              <Field label={l.name} hint={l.expected === null ? undefined : `Expected ${amount(l.expected)} ${amountLabel(l.unit)}`} error={errors[l.productId]}>
                <div className="flex items-center gap-2">
                  <Input
                    inputMode="decimal"
                    autoComplete="off"
                    className="h-12 text-lg md:h-12"
                    value={off ? "" : (e?.value ?? "")}
                    disabled={off}
                    onChange={(event) => patch(l.productId, { value: event.target.value })}
                  />
                  <span className="w-12 shrink-0 text-md text-fg-muted">{amountLabel(l.unit)}</span>
                </div>
              </Field>
              <label className="flex min-h-12 items-center gap-3">
                <input type="checkbox" className="size-6" checked={off} onChange={(event) => patch(l.productId, { notOnTruck: event.target.checked, value: "" })} />
                <span>Not on truck</span>
              </label>
            </li>
          );
        })}
      </ul>
      {failed ? <Alert tone="danger">Could not save on this phone. Try again.</Alert> : null}
      {Object.keys(errors).length ? <Alert tone="warning">Fill in every product, or mark it not on truck.</Alert> : null}
      <Button type="submit" size="lg" loading={busy} disabled={check.lines.length === 0}>
        Submit check
      </Button>
    </form>
  );
}
