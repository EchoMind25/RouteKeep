// Route optimization (D-07, NFR-07).
//
// Adapters: "estimate" orders stops locally from straight-line distances and
// sends nothing anywhere (the default, and the privacy path). Google Route
// Optimization (D-07 adapter 1) and VROOM + OSRM (adapter 2) implement the
// same interface; they need credentials or a server the owner provides, so
// they are added when those exist and can be tested against the real API.

import { flaggedStops, legsFor, orderStops, timings, totals, type LatLng, type Leg, type RouteStop, type StopTiming } from "@/lib/domain/routing";

export interface OptimizeInput {
  start: LatLng | null;
  /** Current order, used as the baseline a proposal must justify itself against. */
  stops: RouteStop[];
  dayStart: string;
}

export interface RoutePlan {
  order: string[];
  legs: Leg[];
  timings: StopTiming[];
  meters: number;
  seconds: number;
  flagged: string[];
  /** True when distances are straight-line estimates, not road distances. */
  estimate: boolean;
  provider: string;
}

export interface RouteOptimizer {
  readonly name: string;
  optimize(input: OptimizeInput): Promise<RoutePlan>;
  /** Measures a given order without changing it (for before/after previews). */
  measure(input: OptimizeInput): Promise<RoutePlan>;
}

function planFor(order: RouteStop[], input: OptimizeInput, provider: string): RoutePlan {
  const legs = legsFor(order, input.start);
  const t = totals(legs);
  return {
    order: order.map((s) => s.id),
    legs,
    timings: timings(order, legs, input.dayStart),
    meters: t.meters,
    seconds: t.seconds,
    flagged: [...flaggedStops(legs)],
    estimate: true,
    provider,
  };
}

export const estimateOptimizer: RouteOptimizer = {
  name: "estimate",
  async optimize(input) {
    return planFor(orderStops(input.stops, input.start, { dayStart: input.dayStart }), input, "estimate");
  },
  async measure(input) {
    return planFor(input.stops, input, "estimate");
  },
};
