"use client";

import { ArrowsClockwise, CaretRight, CheckCircle, CloudCheck, CloudSlash, CurrencyDollar, Gear, SignOut, Sun, UserPlus, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Alert, EmptyState } from "@/components/ui/layout";
import { cn } from "@/lib/cn";
import { httpSync } from "@/lib/providers/sync";
import { publicEnv } from "@/lib/public-env";
import { TechStore, type TechState } from "@/lib/sync/client-store";
import { SyncEngine, type SyncState } from "@/lib/sync/engine";
import { recordDue } from "@/lib/sync/stop-draft";
import { formatDeadline, formatLocalDate, formatWindow } from "@/lib/ui/format";
import type { SnapshotStop } from "@/lib/sync/protocol";
import { TechContext, useTech } from "./context";
import { StopScreen } from "./stop-screen";
import { useNow } from "./use-now";
import { go, useView } from "./use-view";

// The technician app (FR-TEC-01..11). Every screen reads the device copy; the
// network is only ever used in the background (FR-TEC-02).

const NOT_READY: TechState = { ready: false, info: null, stops: [], products: [], mixes: new Map(), drafts: new Map(), outbox: [], notices: [], blobs: new Map() };
const THEME_KEY = "rk-tech-theme";

/** Runs before hydration so outdoor mode never flashes (FR-TEC-11). */
export const THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_KEY}")==="outdoor")document.documentElement.dataset.theme="outdoor"}catch(e){}`;

function registerWorker(version: string) {
  if (!publicEnv.production || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: "/tech" })
    .then((registration) => {
      // Everything this page loaded, so a cold start offline finds it all.
      // Not `serviceWorker.ready`: after sign-in this page was created at
      // /sign-in, outside the worker's scope, so `ready` would never settle.
      const urls = performance.getEntriesByType("resource").map((e) => e.name);
      const warm = (worker: ServiceWorker) => worker.postMessage({ type: "warm", urls });
      if (registration.active) warm(registration.active);
      const pending = registration.installing ?? registration.waiting;
      pending?.addEventListener("statechange", () => {
        if (pending.state === "activated") warm(pending);
      });
    })
    .catch(() => undefined);
}

/** A stop's state on this device: what the technician did here wins until the server catches up. */
export function localStatus(stop: SnapshotStop, state: TechState): { label: string; tone: "neutral" | "accent" | "success" | "warning"; done: boolean } {
  const draft = state.drafts.get(stop.id);
  const queued = state.outbox.filter((o) => o.appointmentId === stop.id);
  const waiting = queued.length > 0;
  if (draft?.skippedAt || queued.some((o) => o.mutation.kind === "skip")) return { label: waiting ? "Skipped, waiting to upload" : "Skipped", tone: "warning", done: true };
  if (draft?.completedAt || stop.status === "completed" || queued.some((o) => o.mutation.kind === "complete")) {
    return { label: waiting ? "Done, waiting to upload" : "Done", tone: "success", done: true };
  }
  if (draft?.rejection) return { label: "Needs a fix", tone: "warning", done: false };
  if (draft?.arrivedAt || stop.status === "in_progress") return { label: "In progress", tone: "accent", done: false };
  return { label: "", tone: "neutral", done: false };
}

export function TechApp({ userId, appVersion }: { userId: string; appVersion: string }) {
  const [store] = useState(() => new TechStore(userId));
  const [engine] = useState(() => new SyncEngine(store, httpSync));
  const state = useSyncExternalStore(store.subscribe, store.getState, () => NOT_READY);
  const sync = useSyncExternalStore(engine.subscribe, engine.getState, () => SyncEngine.initial);
  const view = useView();

  useEffect(() => {
    let live = true;
    void store.load().then(() => live && engine.start());
    registerWorker(appVersion);
    return () => {
      live = false;
      engine.stop();
    };
  }, [store, engine, appVersion]);

  const stop = view.stopId ? state.stops.find((s) => s.id === view.stopId) : undefined;

  return (
    <TechContext.Provider value={{ store, engine }}>
      <div className="mx-auto min-h-dvh max-w-xl">
        {!state.ready ? (
          <div className="grid gap-3 p-4" aria-busy="true" aria-label="Opening your route">
            <div className="h-8 w-40 animate-pulse rounded-control bg-sunken" />
            <div className="h-24 animate-pulse rounded-panel bg-sunken" />
            <div className="h-24 animate-pulse rounded-panel bg-sunken" />
          </div>
        ) : stop && state.info ? (
          <StopScreen key={stop.id} stop={stop} state={state} info={state.info} step={view.step} />
        ) : (
          <DayScreen state={state} sync={sync} day={view.day} />
        )}
      </div>
    </TechContext.Provider>
  );
}

/** FR-TEC-05: always says whether work is safe, and how much is still to upload. */
export function SyncChip({ state, sync }: { state: TechState; sync: SyncState }) {
  // Mutations and finished files alike: everything not yet on the server.
  const waiting = state.outbox.length + [...state.blobs.values()].filter((b) => b.ready && !b.uploadedAt).length;
  const { engine } = useTech();
  const waitingText = waiting ? `${waiting} waiting to upload` : null;
  let icon = <CloudCheck size={18} aria-hidden />;
  let line = waiting ? waitingText! : sync.lastSyncAt ? `Up to date ${new Date(sync.lastSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Not synced yet";
  let tone = "border-line bg-surface text-fg";
  if (sync.signedOut) {
    icon = <WarningCircle size={18} aria-hidden />;
    line = waiting ? `Sign in again to upload ${waiting}` : "Sign in again to sync";
    tone = "border-warning/40 bg-warning-soft text-warning";
  } else if (!sync.online) {
    icon = <CloudSlash size={18} aria-hidden />;
    line = waiting ? `Offline, ${waitingText}` : "Offline";
  } else if (sync.syncing) {
    icon = <ArrowsClockwise size={18} aria-hidden className="motion-safe:animate-spin" />;
    line = waiting ? `Uploading ${waiting}` : "Updating";
  } else if (sync.error) {
    icon = <WarningCircle size={18} aria-hidden />;
    line = waiting ? `Can't reach the office, ${waitingText}` : "Can't reach the office";
  }
  return (
    <button
      type="button"
      onClick={() => void engine.syncNow()}
      className={cn("flex min-h-12 w-full items-center gap-3 rounded-control border px-3 py-2 text-left", tone)}
      aria-live="polite"
    >
      {icon}
      <span className="grid min-w-0">
        <span className="font-semibold">All saved on this phone</span>
        <span className="truncate text-sm">{line}</span>
      </span>
    </button>
  );
}

function DayScreen({ state, sync, day }: { state: TechState; sync: SyncState; day: "today" | "tomorrow" }) {
  const { store } = useTech();
  const [settings, setSettings] = useState(false);
  const [needsSignal, setNeedsSignal] = useState(false);
  const info = state.info;
  const date = info ? (day === "tomorrow" ? info.days[1] : info.days[0]) : null;
  const now = useNow();
  const stops = state.stops.filter((s) => s.date === date).sort((a, b) => a.number - b.number);
  const done = stops.filter((s) => localStatus(s, state).done).length;
  // Stops from an earlier day that still have work on this phone.
  const earlier = info ? state.stops.filter((s) => s.date < info.days[0]!).sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number) : [];
  const timeZone = info?.business.timezone ?? "UTC";

  return (
    <div className="grid gap-4 px-4 pt-4 pb-10">
      <header className="flex items-center justify-between gap-3">
        <BrandMark />
        <div className="flex items-center gap-1">
          {info?.canSell ? (
            // FR-SAL-02: adding a customer needs the office's systems, so it needs a connection.
            <Button asChild variant="ghost" size="icon" className="size-12">
              <a
                href="/sales/new"
                aria-label="New customer"
                onClick={(event) => {
                  if (navigator.onLine) return;
                  event.preventDefault();
                  setNeedsSignal(true);
                }}
              >
                <UserPlus size={22} aria-hidden />
              </a>
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => setSettings(true)} className="size-12">
            <Gear size={22} aria-hidden />
          </Button>
        </div>
      </header>

      {needsSignal ? <Alert tone="warning">Adding a customer needs a connection. Your route keeps working offline; try again when you have signal.</Alert> : null}

      <SyncChip state={state} sync={sync} />

      {state.notices.map((n) => (
        <div key={n.key} role="status" className={cn("flex items-start gap-3 rounded-control border px-3 py-2", n.status === "rejected" ? "border-danger/30 bg-danger-soft text-danger" : "border-warning/30 bg-warning-soft text-warning")}>
          <WarningCircle size={18} aria-hidden className="mt-0.5 shrink-0" />
          <p className="text-sm">
            {state.stops.find((s) => s.id === n.appointmentId)?.customerName ?? "A stop"}: {n.message}
          </p>
          <button type="button" className="ml-auto grid size-8 shrink-0 place-items-center rounded-control" aria-label="Dismiss" onClick={() => void store.dismissNotice(n.key)}>
            <X size={16} aria-hidden />
          </button>
        </div>
      ))}

      {sync.notLinked ? (
        <EmptyState title="Your login is not linked to a technician yet">Ask the office to link your account to your technician profile.</EmptyState>
      ) : !info ? (
        <EmptyState title={sync.online ? "Downloading your route" : "Connect once to download your route"}>
          {sync.online ? "This takes a moment the first time." : "After that, this phone keeps today's and tomorrow's stops and works without a connection."}
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{formatLocalDate(date!, "long")}</h1>
            <p className="text-fg-muted">
              {info.technician.name}, {stops.length} {stops.length === 1 ? "stop" : "stops"}
              {stops.length ? `, ${done} done` : ""}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-control bg-sunken p-1" role="tablist" aria-label="Day">
            {(["today", "tomorrow"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={day === d}
                onClick={() => go({ day: d, stopId: null }, { replace: true })}
                className={cn("min-h-12 rounded-control font-semibold", day === d ? "bg-surface text-fg shadow-raised" : "text-fg-muted")}
              >
                {d === "today" ? "Today" : "Tomorrow"}
              </button>
            ))}
          </div>

          {earlier.length ? (
            // Opened from here even when today is empty: their records still have to be finished (CR-02).
            <section aria-labelledby="earlier-heading" className="grid gap-3">
              <div className="grid gap-0.5">
                <h2 id="earlier-heading" className="font-semibold">
                  From an earlier day
                </h2>
                <p className="text-sm text-fg-muted">Kept on this phone until finished and uploaded.</p>
              </div>
              <ol className="grid gap-3" aria-labelledby="earlier-heading">
                {earlier.map((s) => (
                  <StopCard key={s.id} stop={s} state={state} timeZone={timeZone} now={now} showDate />
                ))}
              </ol>
            </section>
          ) : null}

          {stops.length === 0 ? (
            <EmptyState title={day === "today" ? "No stops today" : "No stops tomorrow yet"}>New stops appear here when the office assigns them.</EmptyState>
          ) : (
            <ol className="grid gap-3" aria-label="Stops">
              {stops.map((s) => (
                <StopCard key={s.id} stop={s} state={state} timeZone={timeZone} now={now} />
              ))}
            </ol>
          )}
        </>
      )}

      <Settings open={settings} onOpenChange={setSettings} state={state} />
    </div>
  );
}

function StopCard({ stop, state, timeZone, now, showDate = false }: { stop: SnapshotStop; state: TechState; timeZone: string; now: Date; showDate?: boolean }) {
  const status = localStatus(stop, state);
  // CR-02: the record's deadline, once it is 20 hours or less away.
  const due = status.done ? null : recordDue(stop, state.drafts.get(stop.id), timeZone, now);
  const deadline = due?.overdue ? (
    <Badge tone="danger">Record overdue</Badge>
  ) : due?.warn ? (
    <Badge tone="warning">Record due by {formatDeadline(due.due, timeZone, now)}</Badge>
  ) : null;
  return (
    <li>
      <button
        type="button"
        onClick={() => go({ stopId: stop.id, step: null })}
        className={cn("flex w-full items-center gap-3 rounded-panel border border-line p-4 text-left", status.done ? "bg-sunken" : "bg-surface")}
      >
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-pill text-md font-bold tabular", status.done ? "bg-success-soft text-success" : "bg-fg text-canvas")} aria-hidden>
          {status.done ? <CheckCircle size={22} weight="bold" /> : stop.number}
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="sr-only">Stop {stop.number}: </span>
          <span className="truncate text-md font-semibold">{stop.customerName}</span>
          <span className="truncate text-sm text-fg-muted">{stop.address}</span>
          <span className="text-sm text-fg-muted tabular">
            {showDate ? `${formatLocalDate(stop.date)}, ` : ""}
            {formatWindow(stop.windowStart, stop.windowEnd)}, {stop.serviceType}
          </span>
          {status.label || deadline ? (
            <span className="flex flex-wrap gap-1.5">
              {status.label ? <Badge tone={status.tone}>{status.label}</Badge> : null}
              {deadline}
            </span>
          ) : null}
        </span>
        <CaretRight size={20} aria-hidden className="shrink-0 text-fg-muted" />
      </button>
    </li>
  );
}

/** The theme lives on <html>; watch the attribute rather than copying it into state. */
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function Settings({ open, onOpenChange, state }: { open: boolean; onOpenChange: (open: boolean) => void; state: TechState }) {
  const { store } = useTech();
  const outdoor = useSyncExternalStore(subscribeTheme, () => document.documentElement.dataset.theme === "outdoor", () => false);
  const [confirming, setConfirming] = useState(false);
  const [offline, setOffline] = useState(false);

  function toggleOutdoor() {
    const next = !outdoor;
    if (next) document.documentElement.dataset.theme = "outdoor";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem(THEME_KEY, next ? "outdoor" : "");
    } catch {
      // Private mode: the switch still works for this session.
    }
  }

  async function signOut() {
    if (!navigator.onLine) {
      setOffline(true);
      return;
    }
    // Nothing about customers stays on a phone after sign out.
    await store.close();
    await TechStore.wipe();
    navigator.serviceWorker?.controller?.postMessage({ type: "clear" });
    const form = document.getElementById("tech-sign-out") as HTMLFormElement | null;
    form?.requestSubmit();
  }

  const waiting = state.outbox.length + [...state.blobs.values()].filter((b) => b.ready && !b.uploadedAt).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogContent title="Settings">
          <button type="button" onClick={toggleOutdoor} aria-pressed={outdoor} className="flex min-h-12 items-center justify-between gap-3 rounded-control border border-line px-4 py-3 text-left">
            <span className="flex items-center gap-3">
              <Sun size={22} aria-hidden />
              <span className="grid">
                <span className="font-semibold">Outdoor mode</span>
                <span className="text-sm text-fg-muted">Highest contrast, for bright sun</span>
              </span>
            </span>
            <span className={cn("rounded-pill px-2 py-0.5 text-sm font-semibold", outdoor ? "bg-fg text-canvas" : "bg-sunken text-fg-muted")}>{outdoor ? "On" : "Off"}</span>
          </button>
          {state.info?.canSell ? (
            <a href="/sales" className="flex min-h-12 items-center gap-3 rounded-control border border-line px-4 py-3 font-semibold">
              <CurrencyDollar size={22} aria-hidden /> My sales and commission
            </a>
          ) : null}
          {offline ? <Alert tone="warning">Signing out needs a connection. Everything stays saved on this phone until then.</Alert> : null}
          {confirming && waiting ? (
            <Alert tone="danger" title={`${waiting} ${waiting === 1 ? "change has" : "changes have"} not uploaded yet`}>
              Signing out now deletes {waiting === 1 ? "it" : "them"} from this phone. Connect and wait for the upload first if you can.
            </Alert>
          ) : null}
          <Button
            variant={confirming && waiting ? "danger" : "secondary"}
            size="lg"
            onClick={() => (waiting && !confirming ? setConfirming(true) : void signOut())}
          >
            <SignOut size={20} aria-hidden /> {confirming && waiting ? "Sign out and delete them" : "Sign out"}
          </Button>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
