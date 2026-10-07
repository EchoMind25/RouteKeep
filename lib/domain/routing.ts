// Route ordering, drive-time estimates and route checks (FR-DSP-03, FR-DSP-06).
//
// Pure functions. The estimate adapter uses these without calling anyone,
// so ordering works with no third party at all (NFR-08); a provider such as
// Google replaces only the distances and the ordering, never the checks.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteStop extends LatLng {
  id: string;
  durationMin: number;
  /** "HH:MM" arrival window, both optional. */
  windowStart: string | null;
  windowEnd: string | null;
}

export interface Leg {
  fromId: string | null;
  toId: string;
  meters: number;
  seconds: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
/** Straight lines are shorter than roads; a common suburban detour factor. */
export const ROAD_FACTOR = 1.35;
/** Average door-to-door speed for suburban service routes, metres per second (40 km/h). */
export const AVERAGE_SPEED_MPS = 40_000 / 3600;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function estimateLeg(a: LatLng, b: LatLng): { meters: number; seconds: number } {
  const meters = haversineMeters(a, b) * ROAD_FACTOR;
  return { meters, seconds: meters / AVERAGE_SPEED_MPS };
}

export function legsFor(order: readonly RouteStop[], start: LatLng | null, measure = estimateLeg): Leg[] {
  const legs: Leg[] = [];
  let prev: (LatLng & { id: string | null }) | null = start ? { ...start, id: null } : null;
  for (const stop of order) {
    if (prev) {
      const m = measure(prev, stop);
      legs.push({ fromId: prev.id, toId: stop.id, ...m });
    }
    prev = stop;
  }
  return legs;
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

function clock(totalMinutes: number): string {
  const m = Math.round(totalMinutes);
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export interface StopTiming {
  id: string;
  arrival: string;
  departure: string;
  waitMin: number;
  /** Arrives after the window closes. */
  late: boolean;
}

/** Arrival times for a route that leaves at `dayStart`, waiting for windows that have not opened. */
export function timings(order: readonly RouteStop[], legs: readonly Leg[], dayStart: string): StopTiming[] {
  const byTarget = new Map(legs.map((l) => [l.toId, l]));
  let now = minutes(dayStart);
  return order.map((stop) => {
    now += (byTarget.get(stop.id)?.seconds ?? 0) / 60;
    const opens = stop.windowStart ? minutes(stop.windowStart) : null;
    const waitMin = opens !== null && now < opens ? opens - now : 0;
    const arrival = now + waitMin;
    const late = stop.windowEnd !== null && arrival > minutes(stop.windowEnd);
    now = arrival + stop.durationMin;
    return { id: stop.id, arrival: clock(arrival), departure: clock(now), waitMin, late };
  });
}

/**
 * FR-DSP-06: stops reached by a leg more than 3x the route's median leg. A
 * long leg usually means a wrong pin (R-BUG-05), and a wrong pin in the middle
 * of a route makes two long legs: the one into it and the one out of it. The
 * leg out is the misplaced stop's doing, so the next stop is not blamed for it.
 * Needs at least three legs to have a meaningful median.
 */
export function flaggedStops(legs: readonly Leg[], factor = 3): Set<string> {
  const flagged = new Set<string>();
  if (legs.length < 3) return flagged;
  const sorted = legs.map((l) => l.seconds).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  if (median <= 0) return flagged;
  for (const leg of legs) {
    if (leg.seconds > factor * median && !(leg.fromId !== null && flagged.has(leg.fromId))) flagged.add(leg.toId);
  }
  return flagged;
}

export function totals(legs: readonly Leg[]): { meters: number; seconds: number } {
  return legs.reduce((t, l) => ({ meters: t.meters + l.meters, seconds: t.seconds + l.seconds }), { meters: 0, seconds: 0 });
}

// Ordering heuristic ------------------------------------------------------------------

type Dist = (a: LatLng, b: LatLng) => number;
type Measure = (a: LatLng, b: LatLng) => { meters: number; seconds: number };
const straight: Dist = (a, b) => haversineMeters(a, b);

export interface OrderOptions {
  /**
   * When the technician leaves. With it, orders are judged on the schedule:
   * fewest late arrivals first, then least lateness, then least driving.
   * Without it, on distance alone.
   */
  dayStart?: string;
  measure?: Measure;
}

/** How good an order is for the day: lexicographic, lateness before driving. */
export interface ScheduleScore {
  late: number;
  lateMin: number;
  meters: number;
}

function nearestNeighbour(stops: RouteStop[], from: LatLng | null, dist: Dist): RouteStop[] {
  const left = [...stops];
  const out: RouteStop[] = [];
  let here: LatLng | null = from ?? left[0] ?? null;
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) {
      if (dist(here!, left[i]!) < dist(here!, left[best]!)) best = i;
    }
    const picked = left.splice(best, 1)[0]!;
    out.push(picked);
    here = picked;
  }
  return out;
}

function pathLength(order: readonly LatLng[], from: LatLng | null, dist: Dist): number {
  let total = 0;
  let prev = from;
  for (const p of order) {
    if (prev) total += dist(prev, p);
    prev = p;
  }
  return total;
}

/** 2-opt on an open path (no return to start), keeping endpoints flexible. */
function twoOpt(order: RouteStop[], from: LatLng | null, dist: Dist): RouteStop[] {
  const route = [...order];
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < route.length - 1; i++) {
      for (let k = i + 1; k < route.length; k++) {
        const before = i === 0 ? from : route[i - 1]!;
        const after = k + 1 < route.length ? route[k + 1]! : null;
        const current = (before ? dist(before, route[i]!) : 0) + (after ? dist(route[k]!, after) : 0);
        const swapped = (before ? dist(before, route[k]!) : 0) + (after ? dist(route[i]!, after) : 0);
        if (swapped + 1e-6 < current) {
          route.splice(i, k - i + 1, ...route.slice(i, k + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return route;
}

/**
 * Leg costs between every pair of stops, and from the start, computed once:
 * the schedule search evaluates thousands of candidate orders.
 */
class Matrix {
  readonly seconds: Float64Array;
  readonly meters: Float64Array;
  readonly size: number;
  constructor(
    readonly stops: readonly RouteStop[],
    readonly start: LatLng | null,
    measure: Measure,
  ) {
    // Index stops.length is the start point.
    this.size = stops.length + 1;
    this.seconds = new Float64Array(this.size * this.size);
    this.meters = new Float64Array(this.size * this.size);
    const points: (LatLng | null)[] = [...stops, start];
    for (let a = 0; a < this.size; a++) {
      for (let b = 0; b < stops.length; b++) {
        const from = points[a];
        if (a === b || !from) continue;
        const leg = measure(from, stops[b]!);
        this.seconds[a * this.size + b] = leg.seconds;
        this.meters[a * this.size + b] = leg.meters;
      }
    }
  }

  score(order: readonly number[], dayStart: string): ScheduleScore {
    let now = minutes(dayStart);
    let prev = this.start ? this.stops.length : -1;
    let late = 0;
    let lateMin = 0;
    let meters = 0;
    for (const i of order) {
      const stop = this.stops[i]!;
      if (prev >= 0) {
        now += this.seconds[prev * this.size + i]! / 60;
        meters += this.meters[prev * this.size + i]!;
      }
      if (stop.windowStart) now = Math.max(now, minutes(stop.windowStart));
      if (stop.windowEnd && now > minutes(stop.windowEnd)) {
        late += 1;
        lateMin += now - minutes(stop.windowEnd);
      }
      now += stop.durationMin;
      prev = i;
    }
    return { late, lateMin, meters };
  }
}

/** True when `a` is a better day than `b`. Tolerances keep float noise from counting as progress. */
export function betterScore(a: ScheduleScore, b: ScheduleScore): boolean {
  if (a.late !== b.late) return a.late < b.late;
  if (Math.abs(a.lateMin - b.lateMin) > 0.5) return a.lateMin < b.lateMin;
  return a.meters < b.meters - 1;
}

export function scheduleScore(order: readonly RouteStop[], start: LatLng | null, dayStart: string, measure: Measure = estimateLeg): ScheduleScore {
  return new Matrix(order, start, measure).score(
    order.map((_, i) => i),
    dayStart,
  );
}

/**
 * Orders a day's stops: windowed stops in window order (morning before
 * afternoon), each window group ordered by nearest neighbour then 2-opt, and
 * stops with no window slotted in wherever they cost the least. With a day
 * start, the order is then polished stop by stop against the schedule.
 *
 * `stops` is taken as the current order, and the result is never worse than
 * it: with a day start, never more late arrivals, more lateness, or (at
 * equal lateness) more driving; without one, never a longer route on a day
 * without windows. Optimizing can only help.
 */
export function orderStops(stops: readonly RouteStop[], start: LatLng | null, options: OrderOptions = {}): RouteStop[] {
  const measure = options.measure ?? estimateLeg;
  const dist: Dist = options.measure ? (a, b) => measure(a, b).meters : straight;
  if (!options.dayStart) {
    const proposed = proposeOrder(stops, start, dist, null);
    const hasWindows = stops.some((s) => s.windowStart || s.windowEnd);
    if (!hasWindows && pathLength(proposed, start, dist) > pathLength(stops, start, dist)) return [...stops];
    return proposed;
  }

  const matrix = new Matrix(stops, start, measure);
  const index = new Map(stops.map((s, i) => [s.id, i]));
  const current = stops.map((_, i) => i);
  const proposed = polish(
    proposeOrder(stops, start, dist, (order) => matrix.score(order.map((s) => index.get(s.id)!), options.dayStart!)).map((s) => index.get(s.id)!),
    matrix,
    options.dayStart,
  );
  const best = betterScore(matrix.score(proposed, options.dayStart), matrix.score(current, options.dayStart)) ? proposed : current;
  return best.map((i) => stops[i]!);
}

function proposeOrder(stops: readonly RouteStop[], start: LatLng | null, dist: Dist, score: ((order: RouteStop[]) => ScheduleScore) | null): RouteStop[] {
  const windowed = stops.filter((s) => s.windowStart || s.windowEnd);
  const flexible = stops.filter((s) => !s.windowStart && !s.windowEnd);

  const groups = new Map<string, RouteStop[]>();
  for (const s of windowed) {
    const key = s.windowStart ?? "00:00";
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  const route: RouteStop[] = [];
  for (const key of [...groups.keys()].sort()) {
    const from = route.at(-1) ?? start;
    route.push(...twoOpt(nearestNeighbour(groups.get(key)!, from, dist), from, dist));
  }

  if (route.length === 0) return twoOpt(nearestNeighbour(flexible, start, dist), start, dist);

  for (const s of flexible) {
    let bestAt = route.length;
    let bestCost = Infinity;
    let bestScore: ScheduleScore | null = null;
    for (let i = 0; i <= route.length; i++) {
      const prev = i === 0 ? start : route[i - 1]!;
      const next = route[i] ?? null;
      const added = (prev ? dist(prev, s) : 0) + (next ? dist(s, next) : 0) - (prev && next ? dist(prev, next) : 0);
      if (score) {
        // Cheapest place that does not make anyone late, if there is one.
        const candidate = score([...route.slice(0, i), s, ...route.slice(i)]);
        if (bestScore === null || betterScore(candidate, bestScore)) {
          bestScore = candidate;
          bestAt = i;
        }
      } else if (added < bestCost) {
        bestCost = added;
        bestAt = i;
      }
    }
    route.splice(bestAt, 0, s);
  }
  return route;
}

/**
 * Relocate search: move one stop at a time to the position that most improves
 * the day, until nothing improves. Cubic per pass, so passes are capped by size.
 */
function polish(order: number[], matrix: Matrix, dayStart: string): number[] {
  let best = order;
  let bestScore = matrix.score(best, dayStart);
  const passes = best.length > 80 ? 2 : 6;
  for (let pass = 0; pass < passes; pass++) {
    let improved = false;
    for (let from = 0; from < best.length; from++) {
      for (let to = 0; to < best.length; to++) {
        if (to === from) continue;
        const candidate = [...best];
        const [moved] = candidate.splice(from, 1);
        candidate.splice(to, 0, moved!);
        const score = matrix.score(candidate, dayStart);
        if (betterScore(score, bestScore)) {
          best = candidate;
          bestScore = score;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return best;
}

export function routeLength(order: readonly RouteStop[], start: LatLng | null, dist: Dist = straight): number {
  return pathLength(order, start, dist);
}
