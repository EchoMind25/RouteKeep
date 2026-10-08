"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { StepId } from "@/lib/sync/client-store";

// Which screen the technician app shows, kept in the URL (?stop=..&step=..)
// so the phone's back button works. Changing it never asks the server for
// anything, so it works the same offline (FR-TEC-02).

export interface View {
  stopId: string | null;
  step: StepId | null;
  day: "today" | "tomorrow";
}

const EVENT = "rk:view";
const SERVER: View = { stopId: null, step: null, day: "today" };
let lastSearch: string | null = null;
let lastView: View = SERVER;

function read(): View {
  if (location.search !== lastSearch) {
    const p = new URLSearchParams(location.search);
    lastSearch = location.search;
    lastView = { stopId: p.get("stop"), step: (p.get("step") as StepId | null) ?? null, day: p.get("day") === "tomorrow" ? "tomorrow" : "today" };
  }
  return lastView;
}

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

export function useView(): View {
  return useSyncExternalStore(subscribe, read, () => SERVER);
}

/**
 * Screens swap without a page load, so a screen reader would stay on the old
 * control. When `key` changes (and on first show), move focus to the screen's
 * heading and scroll to the top. Put the returned ref on a heading with
 * tabIndex={-1}. NFR accessibility, FR-TEC-11.
 */
export function useFocusHeading<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    ref.current?.focus({ preventScroll: true });
  }, [key]);
  return ref;
}

export function go(next: Partial<View>, { replace = false } = {}) {
  const current = read();
  const view = { ...current, ...next };
  const p = new URLSearchParams();
  if (view.stopId) p.set("stop", view.stopId);
  if (view.stopId && view.step) p.set("step", view.step);
  if (view.day === "tomorrow") p.set("day", "tomorrow");
  const url = `${location.pathname}${p.size ? `?${p}` : ""}`;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(EVENT));
  window.scrollTo({ top: 0 });
}
