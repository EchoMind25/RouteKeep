"use client";

import { useSyncExternalStore } from "react";
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
