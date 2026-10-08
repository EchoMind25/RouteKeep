"use client";

import { ArrowLeft, CheckCircle, NavigationArrow, PaperPlaneTilt, Phone, Plus, Trash, WarningCircle } from "@phosphor-icons/react";
import { useState, type ReactNode, type Ref } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/layout";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/domain/money";
import { STEPS, type ApplicationEntry, type Draft, type SnapshotInfo, type StepId, type TechState } from "@/lib/sync/client-store";
import type { SnapshotProduct, SnapshotStop } from "@/lib/sync/protocol";
import { attachmentKeys, buildComplete, key, missingFields, newApplication, newDraft, paymentProblem, recordDue } from "@/lib/sync/stop-draft";
import { formatDeadline, formatWindow } from "@/lib/ui/format";
import { ApplicationEditor } from "./application-editor";
import { useTech } from "./context";
import { PhotoStep } from "./photo-step";
import { SignatureStep } from "./signature-step";
import { localStatus } from "./tech-app";
import { useNow } from "./use-now";
import { go, useFocusHeading } from "./use-view";

// One stop (FR-TEC-03): details, then Arrive, Checklist, Products, Photos,
// Signature, Payment, Complete. Every change is saved on the phone as it is
// made (FR-TEC-04, ENG-09); nothing here waits for the network.

const SKIP_REASONS = ["Nobody home", "Gate locked or no access", "Customer asked to reschedule", "Weather", "Dog in the yard"];

function navigateHref(stop: SnapshotStop): string {
  const destination = stop.lat !== null && stop.lng !== null ? `${stop.lat},${stop.lng}` : stop.address;
  // FR-TEC-10: the phone's own maps app. Apple devices open Apple Maps; everything else opens Google Maps.
  if (/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document) return `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

export function StopScreen({ stop, state, info, step }: { stop: SnapshotStop; state: TechState; info: SnapshotInfo; step: StepId | null }) {
  const draft = state.drafts.get(stop.id);
  const status = localStatus(stop, state);
  const notice = state.notices.find((n) => n.appointmentId === stop.id);

  if (status.done) return <DoneScreen stop={stop} draft={draft} label={status.label} />;
  if (!draft || !step) return <Details stop={stop} draft={draft} notice={notice?.message} timeZone={info.business.timezone} />;
  return <Flow stop={stop} draft={draft} state={state} info={info} step={step} />;
}

function TopBar({ stop, onBack, headingRef, children }: { stop: SnapshotStop; onBack: () => void; headingRef?: Ref<HTMLHeadingElement>; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 grid gap-2 border-b border-line bg-canvas/95 px-4 pt-3 pb-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="size-12 shrink-0" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={22} aria-hidden />
        </Button>
        <div className="min-w-0">
          <p className="text-sm text-fg-muted tabular">Stop {stop.number}</p>
          <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="truncate text-lg font-semibold focus:outline-none">
            {stop.customerName}
          </h1>
        </div>
      </div>
      {children}
    </header>
  );
}

/** FR-TEC-11: primary actions sit under the thumb. */
function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface">
      <div className="mx-auto flex max-w-xl gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{children}</div>
    </div>
  );
}

/** CR-02: once a stop's records are due within 4 hours, or late, say so where the work is done. */
function RecordDueAlert({ stop, draft, timeZone }: { stop: SnapshotStop; draft: Draft | undefined; timeZone: string }) {
  const now = useNow();
  const due = recordDue(stop, draft, timeZone, now);
  if (!due || !(due.warn || due.overdue)) return null;
  const when = formatDeadline(due.due, timeZone, now);
  return due.overdue ? (
    <Alert tone="danger" title={`Record overdue since ${when}`}>
      Records are due within 24 hours of the application. Complete this stop now; the office will see when it was recorded.
    </Alert>
  ) : (
    <Alert tone="warning" title={`Record due by ${when}`}>
      Records are due within 24 hours of the application. Complete this stop to finish its record.
    </Alert>
  );
}

function Details({ stop, draft, notice, timeZone }: { stop: SnapshotStop; draft: Draft | undefined; notice?: string; timeZone: string }) {
  const { store, engine } = useTech();
  const [skipping, setSkipping] = useState(false);
  const headingRef = useFocusHeading<HTMLHeadingElement>(stop.id);

  // Started already: on this phone, or (after a reinstall or on another phone) as far as the office knows.
  const started = Boolean(draft) || stop.status === "in_progress";
  // FR-MSG-01: queued like any other action, so it works with no signal and goes once.
  const [told, setTold] = useState(() => store.getState().outbox.some((o) => o.appointmentId === stop.id && o.mutation.kind === "on_the_way"));

  async function onMyWay() {
    await store.enqueue({ kind: "on_the_way", key: key("on-the-way"), appointmentId: stop.id, date: stop.date, at: new Date().toISOString() });
    engine.request();
    setTold(true);
  }

  async function start() {
    if (draft) return go({ stopId: stop.id, step: draft.step });
    if (stop.status === "in_progress") {
      // Carry on from the arrival the office already has; no second arrival is sent.
      await store.putDraft(newDraft(stop, stop.arrivedAt ? new Date(stop.arrivedAt) : new Date()));
      return go({ stopId: stop.id, step: "checklist" });
    }
    const fresh = newDraft(stop, new Date());
    await store.record(fresh, { kind: "arrive", key: key("arrive"), appointmentId: stop.id, date: stop.date, at: fresh.arrivedAt! });
    engine.request();
    go({ stopId: stop.id, step: "checklist" });
  }

  return (
    <div className="pb-28">
      <TopBar stop={stop} onBack={() => go({ stopId: null, step: null })} headingRef={headingRef} />
      <div className="grid gap-4 p-4">
        {notice ? <Alert tone="warning">{notice}</Alert> : null}
        <RecordDueAlert stop={stop} draft={draft} timeZone={timeZone} />
        <div className="grid gap-1">
          <p className="text-md">{stop.address}</p>
          <p className="text-fg-muted tabular">
            {formatWindow(stop.windowStart, stop.windowEnd)}, {stop.serviceType}, about {stop.durationMin} min
          </p>
          {stop.isInitial ? (
            <span>
              <Badge tone="accent">First visit</Badge>
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button asChild variant="secondary" size="lg">
            <a href={navigateHref(stop)} target="_blank" rel="noreferrer">
              <NavigationArrow size={20} aria-hidden /> Navigate
            </a>
          </Button>
          {stop.phone ? (
            <Button asChild variant="secondary" size="lg">
              <a href={`tel:${stop.phone}`}>
                <Phone size={20} aria-hidden /> Call
              </a>
            </Button>
          ) : (
            <Button variant="secondary" size="lg" disabled>
              <Phone size={20} aria-hidden /> No phone
            </Button>
          )}
        </div>
        {!started && stop.status === "scheduled" ? (
          told ? (
            <p role="status" className="flex items-center gap-2 font-medium text-success">
              <CheckCircle size={20} weight="fill" aria-hidden /> The customer will get an on-the-way email.
            </p>
          ) : (
            <Button variant="secondary" size="lg" onClick={() => void onMyWay()}>
              <PaperPlaneTilt size={20} aria-hidden /> On my way
            </Button>
          )
        ) : null}
        {stop.accessNotes ? <Note title="Access">{stop.accessNotes}</Note> : null}
        {stop.visitNotes ? <Note title="From the office">{stop.visitNotes}</Note> : null}
        {stop.customerNotes ? <Note title="About the customer">{stop.customerNotes}</Note> : null}
        <Button variant="ghost" size="lg" onClick={() => setSkipping(true)} className="justify-self-start">
          Can&apos;t do this stop
        </Button>
      </div>
      <BottomBar>
        <Button size="lg" className="flex-1" onClick={() => void start()}>
          {started ? "Continue" : "Arrive and start"}
        </Button>
      </BottomBar>
      <SkipDialog stop={stop} draft={draft} open={skipping} onOpenChange={setSkipping} />
    </div>
  );
}

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1 rounded-control border border-line bg-surface px-4 py-3" aria-label={title}>
      <h2 className="text-sm font-semibold text-fg-muted">{title}</h2>
      <p>{children}</p>
    </section>
  );
}

function SkipDialog({ stop, draft, open, onOpenChange }: { stop: SnapshotStop; draft: Draft | undefined; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { store, engine } = useTech();
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  const text = reason === "other" ? other.trim() : reason;

  async function skip() {
    const now = new Date();
    const base = draft ?? { ...newDraft(stop, now), arrivedAt: null };
    // Photos taken before the skip (a locked gate, say) go with it.
    await store.record({ ...base, skippedAt: now.toISOString() }, { kind: "skip", key: key("skip"), appointmentId: stop.id, date: stop.date, at: now.toISOString(), reason: text }, attachmentKeys(base));
    engine.request();
    onOpenChange(false);
    go({ stopId: null, step: null });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogContent title="Why can't this stop be done?" description="The office sees this and can reschedule it.">
          <fieldset className="grid gap-2">
            <legend className="sr-only">Reason</legend>
            {[...SKIP_REASONS, "other"].map((r) => (
              <label key={r} className={cn("flex min-h-12 items-center gap-3 rounded-control border px-4", reason === r ? "border-accent bg-accent-soft" : "border-line")}>
                <input type="radio" name="skip-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="size-5 accent-accent" />
                {r === "other" ? "Something else" : r}
              </label>
            ))}
          </fieldset>
          {reason === "other" ? (
            <label className="grid gap-1">
              <span className="font-medium">What happened?</span>
              <textarea value={other} onChange={(e) => setOther(e.target.value)} rows={2} className="rounded-control border border-line-strong bg-surface px-3 py-2" />
            </label>
          ) : null}
          <Button size="lg" disabled={!text} onClick={() => void skip()}>
            Skip this stop
          </Button>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function DoneScreen({ stop, draft, label }: { stop: SnapshotStop; draft: Draft | undefined; label: string }) {
  const headingRef = useFocusHeading<HTMLHeadingElement>(stop.id);
  return (
    <div className="pb-28">
      <TopBar stop={stop} onBack={() => go({ stopId: null, step: null })} headingRef={headingRef} />
      <div className="grid gap-4 p-4">
        <div className="flex items-center gap-3 rounded-panel border border-success/30 bg-success-soft p-4 text-success">
          <CheckCircle size={28} weight="fill" aria-hidden />
          <p className="font-semibold">{label}</p>
        </div>
        {draft?.applications.length ? <p className="text-fg-muted">{draft.applications.length === 1 ? "1 product recorded." : `${draft.applications.length} products recorded.`}</p> : null}
        <p className="text-fg-muted">{stop.address}</p>
      </div>
      <BottomBar>
        <Button size="lg" variant="secondary" className="flex-1" onClick={() => go({ stopId: null, step: null })}>
          Back to the route
        </Button>
      </BottomBar>
    </div>
  );
}

function Flow({ stop, draft, state, info, step }: { stop: SnapshotStop; draft: Draft; state: TechState; info: SnapshotInfo; step: StepId }) {
  const { store, engine } = useTech();
  // Which product card is open. Undefined until someone picks: then the first
  // card still missing something opens, so a stop resumed after the app was
  // killed lands on the field the technician was typing in.
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const index = Math.max(0, STEPS.findIndex((s) => s.id === step));
  const current = STEPS[index]!;
  // Each step is its own screen: focus moves to its heading when the step changes.
  const headingRef = useFocusHeading<HTMLHeadingElement>(current.id);
  const update = (patch: Partial<Draft>) => void store.putDraft({ ...draft, ...patch });
  const goStep = (to: StepId) => {
    update({ step: to });
    go({ stopId: stop.id, step: to });
  };

  const missing = missingFields(draft, stop, state.products, info);
  const payProblem = paymentProblem(draft);

  async function complete() {
    const mutation = buildComplete(draft, stop, info, new Date());
    await store.record({ ...draft, completedAt: mutation.at, rejection: null, step: "review" }, mutation, attachmentKeys(draft));
    engine.request();
    go({ stopId: null, step: null });
  }

  return (
    <div className="pb-28">
      <TopBar stop={stop} onBack={() => (index === 0 ? go({ stopId: stop.id, step: null }) : goStep(STEPS[index - 1]!.id))}>
        <div className="grid gap-1.5">
          <div className="flex justify-between text-sm font-medium">
            <h2 ref={headingRef} tabIndex={-1} className="font-medium focus:outline-none">
              {current.label}
              <span className="sr-only">
                , step {index + 1} of {STEPS.length}
              </span>
            </h2>
            <span className="text-fg-muted tabular" aria-hidden>
              Step {index + 1} of {STEPS.length}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-pill bg-sunken" aria-hidden>
            <div className="h-full rounded-pill bg-accent transition-[width]" style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>
      </TopBar>

      <div className="grid gap-4 p-4">
        {draft.rejection ? <Alert tone="danger" title="The office could not accept this stop">{draft.rejection}</Alert> : null}
        <RecordDueAlert stop={stop} draft={draft} timeZone={info.business.timezone} />

        {current.id === "checklist" ? (
          <>
            {stop.checklist.length ? (
              <fieldset className="grid gap-2">
                <legend className="mb-2 font-semibold">Checklist</legend>
                {stop.checklist.map((label) => (
                  <label key={label} className={cn("flex min-h-12 items-center gap-3 rounded-control border px-4 py-2", draft.checklist[label] ? "border-success/40 bg-success-soft" : "border-line bg-surface")}>
                    <input
                      type="checkbox"
                      checked={Boolean(draft.checklist[label])}
                      onChange={(e) => update({ checklist: { ...draft.checklist, [label]: e.target.checked } })}
                      className="size-6 accent-accent"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="text-fg-muted">No checklist for {stop.serviceType}.</p>
            )}
            <label className="grid gap-1">
              <span className="font-semibold">Notes for the office</span>
              <span className="text-sm text-fg-muted">What you saw, what the customer said, what needs follow-up.</span>
              <textarea value={draft.notes} onChange={(e) => update({ notes: e.target.value })} rows={4} className="rounded-control border border-line-strong bg-surface px-3 py-2 text-md" />
            </label>
          </>
        ) : null}

        {current.id === "products" ? (
          <ProductsStep
            stop={stop}
            draft={draft}
            state={state}
            info={info}
            open={open}
            setOpen={setOpen}
            onChange={(applications) => update({ applications })}
          />
        ) : null}

        {current.id === "photos" ? <PhotoStep stop={stop} draft={draft} blobs={state.blobs} onChange={(photos) => update({ photos })} /> : null}

        {current.id === "signature" ? <SignatureStep stop={stop} draft={draft} blobs={state.blobs} onChange={(signature) => update({ signature })} /> : null}

        {current.id === "payment" ? (
          <fieldset className="grid gap-3">
            <legend className="mb-1 font-semibold">Payment</legend>
            {stop.priceCents !== null ? <p className="text-fg-muted">This visit is {formatCents(stop.priceCents)}.</p> : null}
            {(
              [
                ["invoice_later", "Invoice later", "The office bills the customer."],
                ["cash", "Cash", "You collected cash."],
                ["check", "Check", "You collected a check."],
              ] as const
            ).map(([method, label, hint]) => (
              <label key={method} className={cn("flex min-h-12 items-center gap-3 rounded-control border px-4 py-3", draft.payment.method === method ? "border-accent bg-accent-soft" : "border-line bg-surface")}>
                <input type="radio" name="payment" checked={draft.payment.method === method} onChange={() => update({ payment: { ...draft.payment, method } })} className="size-5 accent-accent" />
                <span className="grid">
                  <span className="font-semibold">{label}</span>
                  <span className="text-sm text-fg-muted">{hint}</span>
                </span>
              </label>
            ))}
            <p className="text-sm text-fg-muted">Card payments are taken online once billing is set up; never write card numbers down here.</p>
            {draft.payment.method !== "invoice_later" ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="font-medium">Amount collected</span>
                  <input
                    inputMode="decimal"
                    value={draft.payment.amount}
                    onChange={(e) => update({ payment: { ...draft.payment, amount: e.target.value } })}
                    className="h-12 rounded-control border border-line-strong bg-surface px-3 text-md tabular"
                  />
                </label>
                {draft.payment.method === "check" ? (
                  <label className="grid gap-1">
                    <span className="font-medium">Check number</span>
                    <input
                      inputMode="numeric"
                      value={draft.payment.checkNumber}
                      onChange={(e) => update({ payment: { ...draft.payment, checkNumber: e.target.value } })}
                      className="h-12 rounded-control border border-line-strong bg-surface px-3 text-md tabular"
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            {payProblem ? <p className="text-sm text-danger">{payProblem}</p> : null}
          </fieldset>
        ) : null}

        {current.id === "review" ? (
          <div className="grid gap-4">
            <h2 className="font-semibold">Ready to complete?</h2>
            <dl className="grid gap-2 rounded-control border border-line bg-surface p-4">
              <Row label="Checklist" value={`${Object.values(draft.checklist).filter(Boolean).length} of ${Object.keys(draft.checklist).length} done`} />
              <Row label="Products" value={draft.applications.length ? draft.applications.map((a) => state.products.find((p) => p.id === a.productId)?.name ?? "Product").join(", ") : "None"} />
              <Row label="Photos" value={String(draft.photos.length)} />
              <Row label="Signature" value={draft.signature ? draft.signature.signerName || "Signed" : "None"} />
              <Row label="Payment" value={draft.payment.method === "invoice_later" ? "Invoice later" : `${draft.payment.method === "cash" ? "Cash" : "Check"} ${draft.payment.amount}`} />
            </dl>
            {missing.length || payProblem ? (
              <Alert tone="danger" title="Not yet: these are missing">
                <ul className="grid gap-2">
                  {missing.map((m) => (
                    <li key={m.key} className="grid gap-1">
                      <span>
                        <strong>{m.productName}:</strong> {m.fields.join(", ")}
                      </span>
                      <span>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="min-h-11"
                          onClick={() => {
                            setOpen(m.key);
                            goStep("products");
                          }}
                        >
                          Fix {m.productName}
                        </Button>
                      </span>
                    </li>
                  ))}
                  {payProblem ? <li>Payment: {payProblem}</li> : null}
                </ul>
              </Alert>
            ) : draft.applications.length === 0 ? (
              <Alert tone="warning">No products recorded. That is fine for an inspection; add them if anything was applied.</Alert>
            ) : null}
          </div>
        ) : null}
      </div>

      <BottomBar>
        {current.id === "review" ? (
          <Button size="lg" className="flex-1" disabled={missing.length > 0 || payProblem !== null} onClick={() => void complete()}>
            <CheckCircle size={20} aria-hidden /> Complete stop
          </Button>
        ) : (
          <Button size="lg" className="flex-1" onClick={() => goStep(STEPS[index + 1]!.id)}>
            Next: {STEPS[index + 1]!.label}
          </Button>
        )}
      </BottomBar>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function ProductsStep(props: {
  stop: SnapshotStop;
  draft: Draft;
  state: TechState;
  info: SnapshotInfo;
  open: string | null | undefined;
  setOpen: (key: string | null) => void;
  onChange: (applications: ApplicationEntry[]) => void;
}) {
  const { stop, draft, state, info, setOpen, onChange } = props;
  const incomplete = missingFields(draft, stop, state.products, info)[0]?.key ?? null;
  const open = props.open === undefined ? incomplete : props.open;
  const [picking, setPicking] = useState(draft.applications.length === 0);
  const [query, setQuery] = useState("");
  const last = state.mixes.get(stop.propertyId) ?? [];
  const used = new Set(draft.applications.map((a) => a.productId));
  const byId = new Map(state.products.map((p) => [p.id, p]));

  function add(product: SnapshotProduct) {
    const entry = newApplication(product, last.find((m) => m.productId === product.id), new Date(), info.business.timezone);
    onChange([...draft.applications, entry]);
    setOpen(entry.key);
    setPicking(false);
    setQuery("");
  }

  const lastProducts = last.flatMap((m) => (byId.has(m.productId) ? [byId.get(m.productId)!] : []));
  const favorites = info.favorites.flatMap((id) => (byId.has(id) && !lastProducts.some((p) => p.id === id) ? [byId.get(id)!] : []));
  const matches = state.products.filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()) || (p.epaRegNo ?? "").includes(query));

  return (
    <div className="grid gap-4">
      {draft.applications.map((entry) => (
        <ApplicationEditor
          key={entry.key}
          entry={entry}
          product={byId.get(entry.productId)}
          stop={stop}
          info={info}
          expanded={open === entry.key}
          onToggle={() => setOpen(open === entry.key ? null : entry.key)}
          onChange={(next) => onChange(draft.applications.map((a) => (a.key === entry.key ? next : a)))}
          onRemove={() => onChange(draft.applications.filter((a) => a.key !== entry.key))}
        />
      ))}

      {picking ? (
        <section className="grid gap-3 rounded-panel border border-line bg-surface p-4" aria-label="Add a product">
          <h2 className="font-semibold">Add a product</h2>
          {lastProducts.length ? <PickList title="Used here last time" products={lastProducts} used={used} onPick={add} /> : null}
          {favorites.length ? <PickList title="Your usual" products={favorites} used={used} onPick={add} /> : null}
          <label className="grid gap-1">
            <span className="font-medium">Find a product</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or EPA number" className="h-12 rounded-control border border-line-strong bg-surface px-3 text-md" />
          </label>
          <PickList title="All products" products={matches} used={used} onPick={add} />
          {draft.applications.length ? (
            <Button variant="ghost" className="min-h-11" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          ) : null}
        </section>
      ) : (
        <Button variant="secondary" size="lg" onClick={() => setPicking(true)}>
          <Plus size={20} aria-hidden /> Add a product
        </Button>
      )}
    </div>
  );
}

function PickList({ title, products, used, onPick }: { title: string; products: SnapshotProduct[]; used: Set<string>; onPick: (p: SnapshotProduct) => void }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold text-fg-muted">{title}</h3>
      {products.length === 0 ? <p className="text-sm text-fg-muted">No match.</p> : null}
      <ul className="grid gap-2">
        {products.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p)} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-control border border-line px-3 py-2 text-left hover:bg-sunken">
              <span className="grid min-w-0">
                <span className="truncate font-medium">{p.name}</span>
                <span className="text-sm text-fg-muted">{p.epaRegNo ? `EPA ${p.epaRegNo}` : p.kind === "minimum_risk" ? "Minimum risk, no EPA number" : "No EPA number"}</span>
              </span>
              {used.has(p.id) ? <Badge>Added</Badge> : <Plus size={18} aria-hidden />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="min-h-11" onClick={onClick} aria-label={label}>
      <Trash size={16} aria-hidden /> Remove
    </Button>
  );
}

export function FieldHint({ tone = "muted", children }: { tone?: "muted" | "danger"; children: ReactNode }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-sm", tone === "danger" ? "text-danger" : "text-fg-muted")}>
      {tone === "danger" ? <WarningCircle size={16} aria-hidden className="mt-0.5 shrink-0" /> : null}
      {children}
    </p>
  );
}
