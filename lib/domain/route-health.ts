import type { StopTiming } from "./routing";

// FR-DSP-05, FR-DSP-06: the one-line health of a lane on the dispatch board,
// from the estimates the board already makes. Pure, so it is tested alone.

export interface RouteHealth {
  stops: number;
  driveMin: number;
  serviceMin: number;
  /** When the last stop is estimated to finish ("HH:MM"), or null when no stop has a pin to time. */
  finish: string | null;
  /** Stops estimated to arrive after their window closes. */
  lateCount: number;
  /** Stops that follow an unusually long drive (FR-DSP-06). */
  longLegCount: number;
  /** Stops with no pin yet: the times above leave them out. */
  untimed: number;
}

export function routeHealth(input: { stops: number; driveSeconds: number; serviceMin: number; timings: readonly StopTiming[]; longLegs: number }): RouteHealth {
  const last = input.timings[input.timings.length - 1];
  return {
    stops: input.stops,
    driveMin: Math.round(input.driveSeconds / 60),
    serviceMin: input.serviceMin,
    finish: last?.departure ?? null,
    lateCount: input.timings.filter((t) => t.late).length,
    longLegCount: input.longLegs,
    untimed: Math.max(0, input.stops - input.timings.length),
  };
}

/** The short sentence a screen reader gets instead of the strip. */
export function routeHealthSummary(h: RouteHealth, finishText: string | null): string {
  const parts = [
    `${h.stops} ${h.stops === 1 ? "stop" : "stops"}`,
    `${h.driveMin} minutes driving and ${h.serviceMin} minutes of service`,
    finishText ? `estimated finish ${finishText}` : "no estimated finish yet",
    h.lateCount ? `${h.lateCount} ${h.lateCount === 1 ? "stop" : "stops"} at risk of missing the window` : "no stops at risk",
    h.longLegCount ? `${h.longLegCount} long ${h.longLegCount === 1 ? "leg" : "legs"}` : "no long legs",
  ];
  return `${parts.join(", ")}.`;
}
