"use client";

import {
  closestCorners,
  DndContext,
  pointerWithin,
  type CollisionDetection,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowCounterClockwise, CheckCircle, ClockCountdown, DotsSixVertical, DotsThree, MapPinSimpleArea, Path, Sparkle, Warning, WarningCircle, X } from "@phosphor-icons/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Component, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import {
  commitOptimizeAction,
  dismissProposalAction,
  moveStopAction,
  moveStopToDayAction,
  previewOptimizeAction,
  publishRouteAction,
  requestAiPlanAction,
  stepAiPlanAction,
  scheduleStopAction,
  undoOptimizeAction,
  type BoardResult,
} from "@/app/(office)/schedule/board-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/layout";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { isEnabled } from "@/lib/flags";
import { lateLabel } from "@/lib/domain/running-late";
import { routeHealth, type RouteHealth as Health } from "@/lib/domain/route-health";
import { flaggedStops, legsFor, timings, totals, type RouteStop } from "@/lib/domain/routing";
import type { BoardRoute, BoardStop, OptimizePreview, QueueStop } from "@/lib/server/dispatch";
import { APPOINTMENT_STATUS, formatLocalDate, formatTime, formatWindow } from "@/lib/ui/format";
import { prefersReducedMotion } from "@/components/ui/motion";
import { RouteHealth } from "./route-health";
import type { MapRoute, MapStop } from "./route-map";

const RouteMap = dynamic(() => import("./route-map").then((m) => m.RouteMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-sunken" aria-hidden />,
});

// Lane keys: a technician id, or one of these.
const QUEUE = "queue";
const UNASSIGNED = "unassigned";
const DAY_START = "08:00";
/** Server clamps the index; this means "at the end". */
const AT_END = 100_000;

type Lanes = Record<string, string[]>;

/** The stop whose card should take focus after a menu move; only ever set and read in event handlers. */
const pendingFocus: { id: string | null } = { id: null };

/**
 * Day targets are small, so a pointer over one wins outright; everywhere
 * else (and with the keyboard, which has no pointer) the nearest stop or lane does.
 */
const collision: CollisionDetection = (args) => {
  const day = pointerWithin(args).find((c) => String(c.id).startsWith("day:"));
  return day ? [day] : closestCorners(args);
};

interface Technician {
  id: string;
  display_name: string;
  color_index: number;
  active: boolean;
}

interface LaneAnalysis {
  flagged: Set<string>;
  eta: Map<string, { arrival: string; late: boolean }>;
  driveSeconds: number;
  siteMinutes: number;
  pinned: number;
  health: Health;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function durationText(seconds: number) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
}

function buildLanes(technicians: Technician[], stops: BoardStop[], queue: QueueStop[]): Lanes {
  const lanes: Lanes = { [QUEUE]: queue.map((q) => q.id), [UNASSIGNED]: [] };
  for (const t of technicians) lanes[t.id] = [];
  for (const s of stops) (lanes[s.technicianId ?? UNASSIGNED] ??= []).push(s.id);
  return lanes;
}

/** A stop that may be moved: not started, not done. Cancelled work is restored from the visit page first. */
function movable(s: BoardStop) {
  return s.status === "scheduled" || s.status === "unscheduled" || s.status === "skipped";
}

/** The pin check returns to this day's board when it is done. */
function pinHref(s: BoardStop, date: string) {
  return `/customers/${s.customerId}/properties/${s.propertyId}/pin?date=${date}`;
}

export function DispatchBoard(props: {
  date: string;
  nextDays: string[];
  technicians: Technician[];
  stops: BoardStop[];
  queue: QueueStop[];
  routes: BoardRoute[];
  start: { lat: number; lng: number } | null;
  mapStyleUrl: string;
  /** A result to show on arrival, e.g. after confirming a pin. */
  notice?: string;
  /** D-07 (revised): the AI route planner is configured on this server. */
  aiPlanner?: boolean;
  /** FR-TEC-02: technicians who told the office they are running late today, and by how much. */
  late?: { technicianId: string; delayMin: number }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const byId = useMemo(() => new Map<string, BoardStop | QueueStop>([...props.queue, ...props.stops].map((s) => [s.id, s])), [props.stops, props.queue]);
  const routeOf = useMemo(() => new Map(props.routes.map((r) => [r.technicianId, r])), [props.routes]);
  const colorOf = useMemo(() => new Map(props.technicians.map((t) => [t.id, t.color_index])), [props.technicians]);
  const initialLanes = useMemo(() => buildLanes(props.technicians, props.stops, props.queue), [props.technicians, props.stops, props.queue]);

  // `lanes` is what the dispatcher sees, including a drag in progress.
  // `base` is what the server holds, as far as this page knows; every write
  // sends the lanes it touches from `base` so the server can refuse a stale move.
  const [lanes, setLanes] = useState(initialLanes);
  const [base, setBase] = useState(initialLanes);
  const [shown, setShown] = useState(initialLanes);
  if (shown !== initialLanes) {
    // Fresh data from the server replaces any local guess.
    setShown(initialLanes);
    setLanes(initialLanes);
    setBase(initialLanes);
  }

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLane, setSelectedLane] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(props.notice ? { tone: "success", text: props.notice } : null);
  const dismiss = useCallback(() => setMessage(null), []);
  const [dragging, setDragging] = useState<string | null>(null);
  const origin = useRef<{ lane: string; index: number } | null>(null);
  const [preview, setPreview] = useState<OptimizePreview | null>(null);
  // D-07 (revised): what the AI planner said about its proposal, shown with it.
  const [aiNotes, setAiNotes] = useState<AiNotes | null>(null);
  const [planning, setPlanning] = useState<string | null>(null);
  const [publishCheck, setPublishCheck] = useState<{ technicianId: string; flagged: string[] } | null>(null);
  // The two dialogs below open from code, not from a trigger, so Radix has no
  // opener to give focus back to. Remember the control and its lane (the control
  // itself can be replaced, e.g. Publish becomes a badge) and restore on close.
  const opener = useRef<{ element: HTMLElement | null; lane: string } | null>(null);
  const rememberOpener = (lane: string) => {
    opener.current = { element: document.activeElement instanceof HTMLElement ? document.activeElement : null, lane };
  };
  const restoreOpener = (event: Event) => {
    const o = opener.current;
    opener.current = null;
    if (!o) return;
    event.preventDefault();
    const target = o.element?.isConnected ? o.element : document.getElementById(`lane-${o.lane}`)?.querySelector<HTMLElement>("button");
    target?.focus();
  };
  // After a menu move to another lane the stop's card is a new element; focus its menu button.
  const takePendingFocus = () => {
    const id = pendingFocus.id;
    pendingFocus.id = null;
    return id ? (document.getElementById(`stop-${id}`)?.querySelector<HTMLElement>("[data-move-menu]") ?? null) : null;
  };

  // Live estimates per lane in the current order: drive time, arrival times and
  // FR-DSP-06 long-leg flags, from the same pure code the optimizer uses.
  const analysis = useMemo(() => {
    const out = new Map<string, LaneAnalysis>();
    for (const [lane, ids] of Object.entries(lanes)) {
      if (lane === QUEUE) continue;
      const stops = ids.map((id) => byId.get(id)).filter((s): s is BoardStop => !!s);
      const routeStops: RouteStop[] = stops
        .filter((s) => s.lat !== null && s.lng !== null)
        .map((s) => ({ id: s.id, lat: s.lat!, lng: s.lng!, durationMin: s.durationMin, windowStart: s.windowStart, windowEnd: s.windowEnd }));
      const legs = legsFor(routeStops, lane === UNASSIGNED ? null : props.start);
      const t = timings(routeStops, legs, DAY_START);
      const flagged = lane === UNASSIGNED ? new Set<string>() : flaggedStops(legs);
      out.set(lane, {
        flagged,
        eta: new Map(t.map((x) => [x.id, { arrival: x.arrival, late: x.late }])),
        driveSeconds: totals(legs).seconds,
        siteMinutes: stops.reduce((sum, s) => sum + s.durationMin, 0),
        pinned: routeStops.length,
        health: routeHealth({ stops: ids.length, driveSeconds: totals(legs).seconds, serviceMin: stops.reduce((sum, s) => sum + s.durationMin, 0), timings: t, longLegs: flagged.size }),
      });
    }
    return out;
  }, [lanes, byId, props.start]);

  const mapStops: MapStop[] = useMemo(
    () =>
      Object.entries(lanes)
        .filter(([lane]) => lane !== QUEUE)
        .flatMap(([lane, ids]) =>
          ids.flatMap((id, i) => {
            const s = byId.get(id);
            if (!s || s.lat === null || s.lng === null) return [];
            return [{ id, lat: s.lat, lng: s.lng, lane, colorIndex: lane === UNASSIGNED ? null : (colorOf.get(lane) ?? 0), number: i + 1, name: s.customerName, flagged: analysis.get(lane)?.flagged.has(id) ?? false }];
          }),
        ),
    [lanes, byId, colorOf, analysis],
  );
  const mapRoutes: MapRoute[] = useMemo(
    () =>
      Object.entries(lanes)
        .filter(([lane]) => lane !== QUEUE && lane !== UNASSIGNED)
        .map(([lane, ids]) => {
          const coords = ids.map((id) => byId.get(id)).flatMap((s) => (s && s.lat !== null && s.lng !== null ? [[s.lng, s.lat] as [number, number]] : []));
          return { lane, colorIndex: colorOf.get(lane) ?? 0, coords: props.start && coords.length ? [[props.start.lng, props.start.lat] as [number, number], ...coords] : coords };
        }),
    [lanes, byId, colorOf, props.start],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const laneOf = (id: string) => (id in lanes ? id : Object.keys(lanes).find((k) => lanes[k]!.includes(id)));
  const techOf = (lane: string) => (lane === UNASSIGNED ? null : lane);
  const laneName = (lane: string) =>
    lane === UNASSIGNED ? "Unassigned" : lane === QUEUE ? "Needs attention" : (props.technicians.find((t) => t.id === lane)?.display_name ?? "a technician");
  const nameOf = (id: string) => byId.get(id)?.customerName ?? "the stop";
  /** Selecting a stop brings its route into focus, so the map shows that route's numbers. */
  const select = (id: string) => {
    setSelectedId(id);
    const lane = laneOf(id);
    if (lane && lane !== QUEUE) setSelectedLane(lane);
  };
  /** A lane as the server holds it; the unassigned lane has no order to protect. */
  const seen = (lane: string) => (lane === UNASSIGNED ? null : (base[lane] ?? []));

  /** "position 2 of 5 in Sam's route" for the stop being dragged, from the lanes as they are now. */
  const placeText = (activeId: string, overId: string) => {
    const lane = laneOf(overId);
    if (!lane) return "";
    const list = lanes[lane] ?? [];
    const has = list.includes(activeId);
    const position = overId in lanes ? (has ? list.indexOf(activeId) + 1 : list.length + 1) : list.indexOf(overId) + 1;
    return `position ${position} of ${has ? list.length : list.length + 1} in ${laneName(lane)}`;
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const lane = laneOf(String(active.id));
      const list = lane ? lanes[lane]! : [];
      return `Picked up ${nameOf(String(active.id))}${lane ? `, position ${list.indexOf(String(active.id)) + 1} of ${list.length} in ${laneName(lane)}` : ""}.`;
    },
    onDragOver: ({ active, over }) => {
      if (!over) return `${nameOf(String(active.id))} is no longer over a route.`;
      const overId = String(over.id);
      return overId.startsWith("day:") ? `Over ${formatLocalDate(overId.slice(4))}.` : `${nameOf(String(active.id))} is over ${placeText(String(active.id), overId)}.`;
    },
    onDragEnd: ({ active, over }) => {
      if (!over) return "Move cancelled.";
      const overId = String(over.id);
      return overId.startsWith("day:") ? `Dropped ${nameOf(String(active.id))} on ${formatLocalDate(overId.slice(4))}.` : `Dropped ${nameOf(String(active.id))} at ${placeText(String(active.id), overId)}.`;
    },
    onDragCancel: () => "Move cancelled.",
  };
  const screenReaderInstructions = {
    draggable:
      "To pick up a stop, press Space or Enter. Use the arrow keys to move it within a route or to another route. Press Space or Enter again to drop it, or Escape to cancel. The Move stop menu next to each stop does the same without dragging.",
  };

  function persist(run: () => Promise<BoardResult>, next: Lanes, success?: string) {
    const before = base;
    startTransition(async () => {
      const result = await run();
      if (result.ok) {
        setBase(next);
        if (success) setMessage({ tone: "success", text: success });
      } else {
        setLanes(before);
        setMessage({ tone: "danger", text: result.message });
        // Whatever order the refusal's own refresh delivered, end on the server's current board.
        router.refresh();
      }
    });
  }

  function onDragStart({ active }: DragStartEvent) {
    const id = String(active.id);
    const lane = laneOf(id)!;
    origin.current = { lane, index: lanes[lane]!.indexOf(id) };
    setDragging(id);
    setMessage(null);
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const id = String(active.id);
    const overId = String(over.id);
    if (overId.startsWith("day:")) return;
    const from = laneOf(id);
    const to = laneOf(overId);
    // Nothing goes back into the queue from the board.
    if (!from || !to || from === to || to === QUEUE) return;
    setLanes((prev) => {
      const target = [...prev[to]!];
      const at = target.indexOf(overId);
      target.splice(at >= 0 ? at : target.length, 0, id);
      return { ...prev, [from]: prev[from]!.filter((x) => x !== id), [to]: target };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const id = String(active.id);
    const start = origin.current;
    origin.current = null;
    setDragging(null);
    const stop = byId.get(id);
    if (!over || !start || !stop) return setLanes(base);
    const overId = String(over.id);

    if (overId.startsWith("day:")) return moveToDay(id, start.lane, overId.slice(4));

    const lane = laneOf(id)!;
    if (lane === QUEUE || laneOf(overId) === QUEUE) return setLanes(base);
    let items = lanes[lane]!;
    const overIndex = items.indexOf(overId);
    const current = items.indexOf(id);
    if (overIndex >= 0 && overIndex !== current) items = arrayMove(items, current, overIndex);
    const next = { ...lanes, [lane]: items };
    setLanes(next);
    if (lane === start.lane && (items.indexOf(id) === start.index || lane === UNASSIGNED)) return setLanes(base);
    placeStop(id, start.lane, lane, next);
  }

  /** Drag onto a day and the Move menu share this, so both take the same write path (WCAG 2.5.7). */
  function moveToDay(id: string, fromLane: string, toDate: string, success?: string) {
    const stop = byId.get(id);
    if (!stop) return setLanes(base);
    const next = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.filter((x) => x !== id)]));
    setLanes(next);
    const done = success ?? `${stop.customerName} moved to ${formatLocalDate(toDate)}.`;
    if (fromLane === QUEUE) {
      persist(() => scheduleStopAction({ id, version: stop.version, date: toDate, technicianId: stop.technicianId, toIndex: AT_END, toOrder: null }), next, done);
    } else {
      persist(() => moveStopToDayAction({ id, version: stop.version, date: props.date, toDate }), next, done);
    }
  }

  /** The stop is already where `next` puts it (`toLane`); save that. */
  function placeStop(id: string, fromLane: string, toLane: string, next: Lanes, success?: string) {
    const stop = byId.get(id);
    if (!stop) return setLanes(base);
    const toIndex = next[toLane]!.indexOf(id);
    if (fromLane === QUEUE) {
      persist(
        () => scheduleStopAction({ id, version: stop.version, date: props.date, technicianId: techOf(toLane), toIndex, toOrder: seen(toLane) }),
        next,
        success ?? `${stop.customerName} added to ${laneName(toLane)}.`,
      );
      return;
    }
    persist(
      () =>
        moveStopAction({
          id,
          version: stop.version,
          date: props.date,
          fromTechnicianId: techOf(fromLane),
          toTechnicianId: techOf(toLane),
          toIndex,
          fromOrder: seen(fromLane),
          toOrder: seen(toLane),
        }),
      next,
      success,
    );
  }

  /** WCAG 2.5.7: the Move stop menu. Same state change and server action as the drag. */
  const moveMenu = (id: string, lane: string) => {
    const list = lanes[lane] ?? [];
    const index = list.indexOf(id);
    const name = nameOf(id);
    const shift = (by: -1 | 1) => {
      const next = { ...lanes, [lane]: arrayMove(list, index, index + by) };
      setLanes(next);
      placeStop(id, lane, lane, next, `${name} moved to position ${index + by + 1} of ${list.length} in ${laneName(lane)}.`);
    };
    const toLane = (target: string) => {
      const next = { ...lanes, [lane]: list.filter((x) => x !== id), [target]: [...(lanes[target] ?? []), id] };
      setLanes(next);
      pendingFocus.id = id;
      placeStop(id, lane, target, next, `${name} moved to ${laneName(target)}, position ${next[target]!.length} of ${next[target]!.length}.`);
    };
    return {
      lane: laneName(lane),
      canShift: lane !== QUEUE && lane !== UNASSIGNED,
      up: index > 0 ? () => shift(-1) : null,
      down: index >= 0 && index < list.length - 1 ? () => shift(1) : null,
      lanes: [...props.technicians.filter((t) => t.active).map((t) => t.id), UNASSIGNED].filter((l) => l !== lane).map((l) => ({ name: laneName(l), run: () => toLane(l) })),
      days: props.nextDays.map((d) => ({ name: formatLocalDate(d), run: () => moveToDay(id, lane, d) })),
    };
  };

  function optimize(technicianId: string) {
    rememberOpener(technicianId);
    setMessage(null);
    startTransition(async () => {
      const r = await previewOptimizeAction({ technicianId, date: props.date });
      setAiNotes(null);
      if (r.ok) setPreview(r.preview);
      else setMessage({ tone: "danger", text: r.message });
    });
  }

  async function planWithAi(technicianId: string) {
    rememberOpener(technicianId);
    setMessage(null);
    setPlanning(technicianId);
    try {
      const asked = await requestAiPlanAction({ technicianId, date: props.date, key: `ai-${crypto.randomUUID()}` });
      if (!asked.ok) {
        setMessage({ tone: "danger", text: asked.message });
        return;
      }
      // Each step is one short request; the plan is usually ready in under a minute.
      for (let i = 0; i < 40; i++) {
        const r = await stepAiPlanAction({ runId: asked.runId });
        if (!r.ok) {
          setMessage({ tone: "danger", text: r.message });
          return;
        }
        if (r.run.status === "done" && r.run.plan) {
          const plan = r.run.plan;
          setAiNotes({ summary: plan.summary, reasons: plan.reasons, source: plan.source, note: plan.note });
          setPreview({ technicianId, expected: r.run.expected, current: plan.current, proposed: plan.proposed, unplaced: plan.unplaced });
          return;
        }
        if (r.run.status === "failed") {
          setMessage({ tone: "danger", text: r.run.error ?? "The AI planner could not finish. Try Optimize instead." });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      setMessage({ tone: "danger", text: "The AI planner is taking too long. Try again, or use Optimize." });
    } catch {
      setMessage({ tone: "danger", text: "The AI planner could not be reached. Check your connection and try again." });
    } finally {
      setPlanning(null);
    }
  }

  function commit() {
    if (!preview) return;
    const p = preview;
    setPreview(null);
    const order = [...p.proposed.order, ...p.expected.filter((id) => !p.proposed.order.includes(id))];
    setLanes((prev) => ({ ...prev, [p.technicianId]: order }));
    persist(
      () =>
        commitOptimizeAction({
          technicianId: p.technicianId,
          date: props.date,
          order: p.proposed.order,
          expected: p.expected,
          provider: p.proposed.provider,
          stats: { seconds: Math.round(p.proposed.seconds), meters: Math.round(p.proposed.meters), beforeSeconds: Math.round(p.current.seconds) },
        }),
      { ...base, [p.technicianId]: order },
      `New order saved for ${laneName(p.technicianId)}. Undo is on the route until the next change.`,
    );
  }

  /** Close the preview without saving. OPS-03: counted as a refused proposal; never blocks closing. */
  function dismissPreview() {
    if (preview) {
      const engine = preview.proposed.provider === "ai" ? "ai" : "solver";
      void dismissProposalAction({ engine, stops: preview.proposed.order.length }).catch(() => {});
    }
    setPreview(null);
  }

  function undo(technicianId: string) {
    persist(() => undoOptimizeAction({ technicianId, date: props.date, expected: base[technicianId] ?? [] }), base, "Previous order restored.");
  }

  function publish(technicianId: string, confirmed = false) {
    const flagged = [...(analysis.get(technicianId)?.flagged ?? [])];
    if (flagged.length > 0 && !confirmed) {
      rememberOpener(technicianId);
      setPublishCheck({ technicianId, flagged });
      return;
    }
    setPublishCheck(null);
    persist(
      () => publishRouteAction({ technicianId, date: props.date, expected: base[technicianId] ?? [], flaggedStops: flagged.length }),
      base,
      `Route published for ${laneName(technicianId)}.`,
    );
  }

  const laneOrder = [...props.technicians.map((t) => t.id), ...(lanes[UNASSIGNED]!.length || dragging ? [UNASSIGNED] : [])];
  const queueIds = lanes[QUEUE] ?? [];

  return (
    <div className="grid gap-4">
      {/* Results appear in a corner so the board never jumps under the pointer. */}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 grid w-[min(28rem,calc(100vw-2rem))] justify-items-end">
        {message ? <Toast message={message} onDismiss={dismiss} /> : null}
      </div>

      <DndContext
        id="dispatch-board"
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          origin.current = null;
          setDragging(null);
          setLanes(base);
        }}
        accessibility={{ announcements, screenReaderInstructions }}
      >
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="order-2 grid gap-4 md:grid-cols-2 xl:order-none xl:grid-cols-1 2xl:grid-cols-2">
            {laneOrder.map((lane) => {
              const tech = props.technicians.find((t) => t.id === lane);
              const a = analysis.get(lane);
              const route = routeOf.get(lane);
              const ids = lanes[lane] ?? [];
              const late = props.late?.find((n) => n.technicianId === lane);
              return (
                <Lane
                  key={lane}
                  id={lane}
                  title={tech ? `${tech.display_name}${tech.active ? "" : " (inactive)"}` : "Unassigned"}
                  colorIndex={tech?.color_index}
                  selected={selectedLane === lane}
                  onSelect={() => setSelectedLane((cur) => (cur === lane ? null : lane))}
                  summary={`${ids.length} ${ids.length === 1 ? "stop" : "stops"}${a && ids.length ? `, ${durationText(a.siteMinutes * 60)} on site${lane === UNASSIGNED ? "" : `, about ${durationText(a.driveSeconds)} driving`}` : ""}`}
                  actions={
                    tech && ids.length > 0 ? (
                      <>
                        {(a?.pinned ?? 0) > 1 ? (
                          <Button variant="secondary" size="sm" onClick={() => optimize(lane)} disabled={pending || planning !== null} aria-label={`Optimize ${tech.display_name}'s route`}>
                            <Path size={16} aria-hidden /> Optimize
                          </Button>
                        ) : null}
                        {(a?.pinned ?? 0) > 1 && props.aiPlanner ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => planWithAi(lane)}
                            disabled={pending || planning !== null}
                            aria-label={planning === lane ? `Planning ${tech.display_name}'s route with AI` : `Plan ${tech.display_name}'s route with AI`}
                          >
                            <Sparkle size={16} aria-hidden /> {planning === lane ? "Planning…" : "AI plan"}
                          </Button>
                        ) : null}
                        {route?.canUndo ? (
                          <Button variant="ghost" size="sm" disabled={pending} onClick={() => undo(lane)} aria-label={`Undo the last optimize for ${tech.display_name}`}>
                            <ArrowCounterClockwise size={16} aria-hidden /> Undo
                          </Button>
                        ) : null}
                        {route?.published ? (
                          <Badge tone="success">
                            <CheckCircle size={12} aria-hidden /> Published
                          </Badge>
                        ) : (
                          <Button variant="ghost" size="sm" disabled={pending} onClick={() => publish(lane)} aria-label={`${route?.changedSincePublish ? "Republish" : "Publish"} ${tech.display_name}'s route`}>
                            {route?.changedSincePublish ? "Republish" : "Publish"}
                          </Button>
                        )}
                      </>
                    ) : null
                  }
                  badge={
                    late && isEnabled("runningLate") ? (
                      <Badge tone="warning">
                        <ClockCountdown size={12} aria-hidden /> {lateLabel(late.delayMin)}
                      </Badge>
                    ) : null
                  }
                  strip={isEnabled("routeHealth") && tech && a && ids.length ? <RouteHealth health={a.health} laneName={tech.display_name} /> : null}
                  note={route?.changedSincePublish && !route.published ? "Changed since it was published. The technician has the older order until you republish." : undefined}
                >
                  <SortableContext id={lane} items={ids} strategy={verticalListSortingStrategy}>
                    {ids.length ? (
                      <ol className="divide-y divide-line">
                        {ids.map((id, i) => {
                          const s = byId.get(id);
                          if (!s) return null;
                          return (
                            <StopCard
                              key={id}
                              stop={s}
                              date={props.date}
                              number={i + 1}
                              eta={lane === UNASSIGNED ? null : (a?.eta.get(id) ?? null)}
                              flagged={a?.flagged.has(id) ?? false}
                              selected={selectedId === id}
                              onSelect={() => select(id)}
                              disabled={pending}
                              menu={moveMenu(id, lane)}
                              afterMenu={takePendingFocus}
                            />
                          );
                        })}
                      </ol>
                    ) : (
                      <p className="px-4 py-6 text-sm text-fg-muted">{lane === UNASSIGNED ? "Drop a stop here to take it off a route." : "No stops. Drag one here to assign it."}</p>
                    )}
                  </SortableContext>
                </Lane>
              );
            })}
          </div>

          {/* Below xl the queue comes first and the map last; at xl both stay in view beside the lanes (FR-DSP-04). */}
          <div className="contents xl:sticky xl:top-6 xl:grid xl:h-[calc(100dvh-8rem)] xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-4">
            <QueuePanel ids={queueIds} byId={byId} disabled={pending} menuFor={(id) => moveMenu(id, QUEUE)} afterMenu={takePendingFocus} />
            <div className="order-3 h-[55vh] min-h-80 overflow-hidden rounded-panel border border-line xl:order-none xl:h-auto" role="region" aria-label="Map of the day's stops">
              <MapBoundary>
                <RouteMap
                  stops={mapStops}
                  routes={mapRoutes}
                  start={props.start}
                  selectedId={selectedId}
                  selectedLane={selectedLane}
                  onSelect={(id) => {
                    select(id);
                    document.getElementById(`stop-${id}`)?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
                  }}
                  styleUrl={props.mapStyleUrl}
                  fitKey={props.date}
                />
              </MapBoundary>
            </div>
          </div>
        </div>

        {dragging ? (
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 py-3 shadow-overlay">
            <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-2">
              <span className="text-sm text-fg-muted">Drop on a day to move it there:</span>
              {props.nextDays.map((d) => (
                <DayTarget key={d} date={d} />
              ))}
            </div>
          </div>
        ) : null}
      </DndContext>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && dismissPreview()}>
        {preview ? (
          <DialogContent
            title={aiNotes ? `AI plan for ${laneName(preview.technicianId)}` : `Optimize ${laneName(preview.technicianId)}`}
            description="A proposal only. Nothing changes until you save it."
            className="max-w-2xl"
            onCloseAutoFocus={restoreOpener}
          >
            {aiNotes ? <AiPlanNotes notes={aiNotes} byId={byId} /> : null}
            <OptimizeSummary preview={preview} byId={byId} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={dismissPreview}>
                Discard
              </Button>
              <Button onClick={commit}>Save this order</Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={publishCheck !== null} onOpenChange={(open) => !open && setPublishCheck(null)}>
        {publishCheck ? (
          <DialogContent
            title="Check these stops before publishing"
            description="Each is reached by a drive more than three times this route's typical drive. A wrong pin is the usual cause."
            onCloseAutoFocus={restoreOpener}
          >
            <ul className="grid gap-3">
              {publishCheck.flagged.map((id) => {
                const s = byId.get(id);
                return s ? (
                  <li key={id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{s.customerName}</span>
                      <span className="block truncate text-sm text-fg-muted">{s.address}</span>
                    </span>
                    <Link href={pinHref(s, props.date)} className="shrink-0 text-sm font-medium text-accent hover:underline">
                      Check pin<span className="sr-only"> for {s.customerName}</span>
                    </Link>
                  </li>
                ) : null;
              })}
            </ul>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setPublishCheck(null)}>
                Not yet
              </Button>
              <Button onClick={() => publish(publishCheck.technicianId, true)}>Publish anyway</Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function Toast({ message, onDismiss }: { message: { tone: "danger" | "success"; text: string }; onDismiss: () => void }) {
  // Confirmations fade on their own; problems stay until read.
  useEffect(() => {
    if (message.tone !== "success") return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);
  return (
    <div
      role={message.tone === "danger" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-control border py-3 pr-2 pl-4 shadow-overlay",
        message.tone === "danger" ? "border-danger/30 bg-danger-soft text-danger" : "border-success/30 bg-success-soft text-success",
      )}
    >
      <p className="text-sm">{message.text}</p>
      <button type="button" onClick={onDismiss} className="shrink-0 rounded-control p-1 hover:bg-surface/60" aria-label="Dismiss">
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/** A map failure must never take the lists down with it. */
class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <div className="grid h-full place-items-center bg-sunken p-6 text-center text-sm text-fg-muted">The map could not be shown. Everything else on this page still works.</div>
    ) : (
      this.props.children
    );
  }
}

function Lane(props: {
  id: string;
  title: string;
  colorIndex?: number;
  summary: string;
  selected: boolean;
  onSelect: () => void;
  actions: ReactNode;
  note?: string;
  /** FR-TEC-02: shown beside the name, e.g. "Running late +30 min". */
  badge?: ReactNode;
  /** FR-DSP-05: the route health strip, under the header. */
  strip?: ReactNode;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: props.id });
  const headingId = `lane-${props.id}`;
  return (
    <section ref={setNodeRef} aria-labelledby={headingId} className={cn("min-w-0 overflow-hidden rounded-panel border bg-surface", isOver ? "border-accent" : "border-line", props.selected && "ring-2 ring-fg")}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-[12rem] flex-1 items-center gap-3">
          {props.colorIndex !== undefined ? (
            <span className="grid size-8 shrink-0 place-items-center rounded-pill text-xs font-bold" style={{ backgroundColor: `var(--rk-route-${props.colorIndex})`, color: `var(--rk-route-ink-${props.colorIndex})` }} aria-hidden>
              {initials(props.title)}
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 id={headingId} className="truncate font-semibold">
              <button type="button" onClick={props.onSelect} className="max-w-full truncate rounded-control text-left hover:underline" aria-pressed={props.selected} title="Highlight on the map">
                {props.title}
              </button>
            </h2>
            <p className="text-sm text-fg-muted tabular">{props.summary}</p>
            {props.badge ? <div className="mt-1">{props.badge}</div> : null}
          </div>
        </div>
        {props.actions ? <div className="flex flex-wrap items-center gap-1.5">{props.actions}</div> : null}
      </header>
      {props.strip}
      {props.note ? <p className="border-b border-line bg-warning-soft px-4 py-2 text-sm text-warning">{props.note}</p> : null}
      {props.children}
    </section>
  );
}

function StopCard(props: {
  stop: BoardStop;
  date: string;
  number: number;
  eta: { arrival: string; late: boolean } | null;
  flagged: boolean;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
  menu: MoveModel;
  afterMenu: () => HTMLElement | null;
}) {
  const s = props.stop;
  const canMove = movable(s);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: s.id,
    disabled: props.disabled ? true : { draggable: !canMove, droppable: false },
  });
  const status = APPOINTMENT_STATUS[s.status];
  return (
    <li
      id={`stop-${s.id}`}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("grid grid-cols-[2rem_1.75rem_1fr_auto] items-start gap-2 bg-surface px-2 py-3 pr-2", isDragging && "relative z-10 shadow-overlay", props.selected && "bg-accent-soft")}
    >
      {canMove ? (
        <button
          type="button"
          className="mt-0.5 grid size-8 cursor-grab touch-none place-items-center rounded-control text-fg-muted hover:bg-sunken hover:text-fg active:cursor-grabbing"
          aria-label={`Move ${s.customerName}`}
          {...attributes}
          {...listeners}
        >
          <DotsSixVertical size={18} weight="bold" aria-hidden />
        </button>
      ) : (
        <span aria-hidden />
      )}
      {/* FR-DSP-05: the same stop number on the map, the list and the technician app. */}
      <button type="button" onClick={props.onSelect} className="mt-0.5 grid size-7 place-items-center rounded-pill border border-line-strong text-xs font-semibold tabular" aria-label={`Stop ${props.number}: show ${s.customerName} on the map`}>
        {props.number}
      </button>
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <Link href={`/schedule/visits/${s.id}`} className="truncate font-semibold text-fg hover:underline">
            {s.customerName}
          </Link>
          <span className="text-sm text-fg-muted tabular">{formatWindow(s.windowStart, s.windowEnd)}</span>
        </div>
        <p className="truncate text-sm text-fg-muted">{s.address}</p>
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <Badge>{s.serviceType}</Badge>
          {s.status !== "scheduled" && status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
          {props.eta && s.status === "scheduled" ? (
            <Badge tone={props.eta.late ? "danger" : "neutral"}>
              {props.eta.late ? "Late, " : ""}est. {formatTime(props.eta.arrival)}
            </Badge>
          ) : null}
          {s.isInitial ? <Badge tone="accent">First visit</Badge> : null}
          {props.flagged ? (
            <Badge tone="danger">
              <Warning size={12} aria-hidden /> Long drive
            </Badge>
          ) : null}
          {s.needsPin ? (
            <Link href={pinHref(s, props.date)} className="rounded-pill">
              <Badge tone="warning" className="hover:underline">
                <MapPinSimpleArea size={12} aria-hidden /> Check pin<span className="sr-only"> for {s.customerName}</span>
              </Badge>
            </Link>
          ) : null}
        </div>
      </div>
      {canMove ? <MoveMenu label={`Move stop ${props.number}`} model={props.menu} disabled={props.disabled} afterClose={props.afterMenu} /> : <span aria-hidden />}
    </li>
  );
}

interface MoveModel {
  lane: string;
  canShift: boolean;
  up: (() => void) | null;
  down: (() => void) | null;
  lanes: { name: string; run: () => void }[];
  days: { name: string; run: () => void }[];
}

/**
 * WCAG 2.5.7: everything dragging does, available with single clicks or keys.
 * While a save is in flight the items are disabled, not the trigger, so focus
 * can return to the trigger when the menu closes.
 */
function MoveMenu({ label, model, disabled, afterClose }: { label: string; model: MoveModel; disabled: boolean; afterClose: () => HTMLElement | null }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          data-move-menu
          aria-label={label}
          className="mt-0.5 grid size-8 place-items-center rounded-control text-fg-muted hover:bg-sunken hover:text-fg disabled:opacity-55"
        >
          <DotsThree size={20} weight="bold" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent
        onCloseAutoFocus={(event) => {
          // The stop may have a new card in another lane; follow it.
          const target = afterClose();
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        {model.canShift ? (
          <>
            <MenuItem disabled={disabled || !model.up} onSelect={() => model.up?.()}>
              Move up
            </MenuItem>
            <MenuItem disabled={disabled || !model.down} onSelect={() => model.down?.()}>
              Move down
            </MenuItem>
            <MenuSeparator />
          </>
        ) : null}
        {model.lanes.length ? <MenuLabel>Route</MenuLabel> : null}
        {model.lanes.map((l) => (
          <MenuItem key={l.name} disabled={disabled} onSelect={l.run}>
            Move to {l.name}
          </MenuItem>
        ))}
        {model.days.length ? (
          <>
            <MenuSeparator />
            <MenuLabel>Day</MenuLabel>
            {model.days.map((d) => (
              <MenuItem key={d.name} disabled={disabled} onSelect={d.run}>
                Move to {d.name}
              </MenuItem>
            ))}
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
}

function QueuePanel({ ids, byId, disabled, menuFor, afterMenu }: { ids: string[]; byId: Map<string, BoardStop | QueueStop>; disabled: boolean; menuFor: (id: string) => MoveModel; afterMenu: () => HTMLElement | null }) {
  return (
    <section aria-labelledby="queue-heading" className="order-1 grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-panel border border-line bg-surface xl:order-none xl:max-h-[40vh]">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 id="queue-heading" className="flex items-center gap-2 font-semibold">
          <WarningCircle size={18} aria-hidden className="text-warning" /> Needs attention
        </h2>
        <span className="text-sm text-fg-muted tabular">{ids.length}</span>
      </header>
      <SortableContext id={QUEUE} items={ids} strategy={verticalListSortingStrategy}>
        {ids.length ? (
          // A scrollable list must be reachable by keyboard (axe: scrollable-region-focusable).
          <ul tabIndex={0} aria-label="Visits that need attention" className="max-h-72 divide-y divide-line overflow-y-auto xl:max-h-none">
            {ids.map((id) => {
              const s = byId.get(id) as QueueStop | undefined;
              return s ? <QueueCard key={id} stop={s} disabled={disabled} menu={menuFor(id)} afterMenu={afterMenu} /> : null;
            })}
          </ul>
        ) : (
          <p className="px-4 py-4 text-sm text-fg-muted">Nothing waiting. Undated, skipped, cancelled and unassigned visits show up here.</p>
        )}
      </SortableContext>
    </section>
  );
}

function QueueCard({ stop: s, disabled, menu, afterMenu }: { stop: QueueStop; disabled: boolean; menu: MoveModel; afterMenu: () => HTMLElement | null }) {
  const canMove = movable(s);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id, disabled: disabled || !canMove });
  const label = s.status === "scheduled" ? "No technician" : (APPOINTMENT_STATUS[s.status]?.label ?? s.status);
  const tone = s.status === "scheduled" ? "warning" : (APPOINTMENT_STATUS[s.status]?.tone ?? "neutral");
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} id={`stop-${s.id}`} className={cn("grid grid-cols-[2rem_1fr_auto] items-start gap-2 bg-surface px-2 py-2.5 pr-2", isDragging && "relative z-10 shadow-overlay")}>
      {canMove ? (
        <button
          type="button"
          className="grid size-8 cursor-grab touch-none place-items-center rounded-control text-fg-muted hover:bg-sunken hover:text-fg active:cursor-grabbing"
          aria-label={`Move ${s.customerName} onto a route`}
          {...attributes}
          {...listeners}
        >
          <DotsSixVertical size={18} weight="bold" aria-hidden />
        </button>
      ) : (
        <span aria-hidden />
      )}
      <div className="grid min-w-0 gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <Link href={`/schedule/visits/${s.id}`} className="truncate font-medium hover:underline">
            {s.customerName}
          </Link>
          <Badge tone={tone}>{label}</Badge>
        </div>
        <p className="truncate text-sm text-fg-muted">
          {s.localDate ? formatLocalDate(s.localDate) : "No date yet"}
          {s.reason ? `: ${s.reason}` : `, ${s.serviceType}`}
        </p>
      </div>
      {canMove ? <MoveMenu label={`Move ${s.customerName} to a route or day`} model={menu} disabled={disabled} afterClose={afterMenu} /> : <span aria-hidden />}
    </li>
  );
}

function DayTarget({ date }: { date: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` });
  return (
    <div ref={setNodeRef} className={cn("rounded-control border border-dashed px-3 py-2 text-sm font-medium tabular", isOver ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-fg")}>
      {formatLocalDate(date)}
    </div>
  );
}

interface AiNotes {
  summary: string;
  reasons: { id: string; reason: string }[];
  source: "ai" | "solver";
  note: string | null;
}

function AiPlanNotes({ notes, byId }: { notes: AiNotes; byId: Map<string, BoardStop | QueueStop> }) {
  return (
    <div className="grid gap-3">
      {notes.note ? <Alert tone="warning">{notes.note}</Alert> : null}
      <p className="text-md">{notes.summary}</p>
      {notes.reasons.length ? (
        <ul className="grid gap-1.5 text-sm" aria-label="Why stops moved">
          {notes.reasons.map((r) => (
            <li key={r.id} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3">
              <span className="truncate font-medium">{byId.get(r.id)?.customerName ?? "A stop"}</span>
              <span className="text-fg-muted">{r.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function OptimizeSummary({ preview, byId }: { preview: OptimizePreview; byId: Map<string, BoardStop> }) {
  const saved = preview.current.seconds - preview.proposed.seconds;
  const eta = new Map(preview.proposed.timings.map((t) => [t.id, t]));
  const before = new Map(preview.current.order.map((id, i) => [id, i + 1]));
  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-2 gap-4 rounded-control bg-sunken p-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-fg-muted">Driving now</dt>
          <dd className="text-lg font-semibold tabular">{durationText(preview.current.seconds)}</dd>
        </div>
        <div>
          <dt className="text-sm text-fg-muted">Driving after</dt>
          <dd className="text-lg font-semibold tabular">{durationText(preview.proposed.seconds)}</dd>
        </div>
        <div>
          <dt className="text-sm text-fg-muted">Difference</dt>
          <dd className={cn("text-lg font-semibold tabular", saved > 30 ? "text-success" : "text-fg")}>{saved > 30 ? `${durationText(saved)} less` : "About the same"}</dd>
        </div>
      </dl>
      {preview.proposed.estimate ? <p className="text-sm text-fg-muted">Drive times are estimates from straight-line distance. Real roads vary.</p> : null}
      {preview.proposed.flagged.length ? (
        <Alert tone="warning" title="Long drives remain">
          {preview.proposed.flagged.map((id) => byId.get(id)?.customerName).join(", ")}: check these pins.
        </Alert>
      ) : null}
      <ol className="grid max-h-80 gap-1 overflow-y-auto" tabIndex={0} aria-label="Proposed order">
        {preview.proposed.order.map((id, i) => {
          const s = byId.get(id);
          const t = eta.get(id);
          const was = before.get(id);
          return (
            <li key={id} className="grid grid-cols-[2rem_1fr_auto] items-baseline gap-2 text-sm">
              <span className="font-semibold tabular">{i + 1}</span>
              <span className="truncate">
                {s?.customerName}
                {was !== i + 1 ? <span className="text-fg-muted"> (was {was})</span> : null}
              </span>
              <span className={cn("tabular", t?.late ? "text-danger" : "text-fg-muted")}>{t ? `${t.late ? "late, " : ""}${formatTime(t.arrival)}` : ""}</span>
            </li>
          );
        })}
      </ol>
      {preview.unplaced.length ? (
        <p className="text-sm text-fg-muted">
          {preview.unplaced.length === 1 ? "1 stop has" : `${preview.unplaced.length} stops have`} no map pin and {preview.unplaced.length === 1 ? "keeps its" : "keep their"} place at the end.
        </p>
      ) : null}
    </div>
  );
}
