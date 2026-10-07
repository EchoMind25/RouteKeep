"use client";

import { useSyncExternalStore } from "react";

// One shared clock for deadline warnings (CR-02): a screen left open turns
// "due" into "overdue" on its own, and a phone coming back from the lock
// screen shows the current state at once rather than up to a minute later.

const listeners = new Set<() => void>();
let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function tick() {
  current = Date.now();
  for (const listener of listeners) listener();
}

function onVisible() {
  if (document.visibilityState === "visible") tick();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

function getSnapshot() {
  if (!current) current = Date.now();
  return current;
}

/** The time now, updated every 30 seconds and on returning to the app. */
export function useNow(): Date {
  return new Date(useSyncExternalStore(subscribe, getSnapshot, () => 0));
}
