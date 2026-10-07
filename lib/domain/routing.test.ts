import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { betterScore, estimateLeg, flaggedStops, haversineMeters, legsFor, orderStops, routeLength, scheduleScore, timings, type Leg, type RouteStop } from "./routing";

const OREM = { lat: 40.2969, lng: -111.6946 };
const PROVO = { lat: 40.2338, lng: -111.6585 };

function stop(id: string, lat: number, lng: number, extra: Partial<RouteStop> = {}): RouteStop {
  return { id, lat, lng, durationMin: 30, windowStart: null, windowEnd: null, ...extra };
}

const stopArb = fc.record({
  lat: fc.double({ min: 40.1, max: 40.6, noNaN: true }),
  lng: fc.double({ min: -112.0, max: -111.5, noNaN: true }),
});

describe("distances", () => {
  it("measures Orem to Provo at about 7.7 km in a straight line", () => {
    expect(haversineMeters(OREM, PROVO) / 1000).toBeCloseTo(7.7, 0);
    const leg = estimateLeg(OREM, PROVO);
    expect(leg.meters).toBeGreaterThan(haversineMeters(OREM, PROVO));
    expect(leg.seconds / 60).toBeGreaterThan(10);
    expect(leg.seconds / 60).toBeLessThan(25);
  });
});

describe("orderStops", () => {
  it("always returns every stop exactly once", () => {
    fc.assert(
      fc.property(fc.array(stopArb, { minLength: 0, maxLength: 40 }), fc.option(stopArb, { nil: null }), (points, start) => {
        const stops = points.map((p, i) => stop(`s${i}`, p.lat, p.lng, i % 3 === 0 ? { windowStart: "08:00", windowEnd: "12:00" } : {}));
        const order = orderStops(stops, start);
        expect(order.map((s) => s.id).sort()).toEqual(stops.map((s) => s.id).sort());
      }),
      { numRuns: 300 },
    );
  });

  it("never proposes a longer route than the current order on days without windows", () => {
    fc.assert(
      fc.property(fc.array(stopArb, { minLength: 2, maxLength: 30 }), (points) => {
        const stops = points.map((p, i) => stop(`s${i}`, p.lat, p.lng));
        expect(routeLength(orderStops(stops, null), null)).toBeLessThanOrEqual(routeLength(stops, null) + 1e-6);
      }),
      { numRuns: 1000 },
    );
  });

  it("puts morning windows before afternoon windows", () => {
    const stops = [
      stop("pm1", 40.3, -111.7, { windowStart: "12:00", windowEnd: "17:00" }),
      stop("am1", 40.5, -111.9, { windowStart: "08:00", windowEnd: "12:00" }),
      stop("pm2", 40.31, -111.71, { windowStart: "12:00", windowEnd: "17:00" }),
      stop("am2", 40.51, -111.91, { windowStart: "08:00", windowEnd: "12:00" }),
      stop("any", 40.4, -111.8),
    ];
    const ids = orderStops(stops, OREM).map((s) => s.id);
    expect(ids.indexOf("am1")).toBeLessThan(ids.indexOf("pm1"));
    expect(ids.indexOf("am2")).toBeLessThan(ids.indexOf("pm2"));
    expect(ids).toContain("any");
  });

  it("orders 60 stops quickly (NFR-03: one technician, 60 stops, well under 15 s)", () => {
    const stops = Array.from({ length: 60 }, (_, i) =>
      stop(`s${i}`, 40.2 + ((i * 37) % 100) / 300, -111.9 + ((i * 53) % 100) / 300, i % 3 === 0 ? { windowStart: "08:00", windowEnd: "12:00" } : {}),
    );
    const t0 = performance.now();
    orderStops(stops, OREM, { dayStart: "08:00" });
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it("orders a 125-stop lane (a 500-stop day across four technicians) in a few seconds at most", () => {
    const stops = Array.from({ length: 125 }, (_, i) =>
      stop(`s${i}`, 40.2 + ((i * 37) % 100) / 300, -111.9 + ((i * 53) % 100) / 300, { durationMin: 4, ...(i % 4 === 0 ? { windowStart: "12:00", windowEnd: "17:00" } : {}) }),
    );
    const t0 = performance.now();
    orderStops(stops, OREM, { dayStart: "08:00" });
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

describe("orderStops against the schedule", () => {
  const windowArb = fc.constantFrom<[string | null, string | null]>([null, null], ["08:00", "12:00"], ["12:00", "17:00"], ["08:00", "10:00"], [null, "11:00"], ["13:00", null]);

  it("never proposes a worse day than the current order: no more late stops, lateness or (at equal lateness) driving", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(stopArb, windowArb, fc.integer({ min: 10, max: 60 })), { minLength: 1, maxLength: 25 }),
        fc.option(stopArb, { nil: null }),
        (rows, start) => {
          const stops = rows.map(([p, [ws, we], d], i) => stop(`s${i}`, p.lat, p.lng, { windowStart: ws, windowEnd: we, durationMin: d }));
          const before = scheduleScore(stops, start, "08:00");
          const after = scheduleScore(orderStops(stops, start, { dayStart: "08:00" }), start, "08:00");
          expect(betterScore(before, after)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("does not let a stop with no window push a windowed stop late when there is room after it", () => {
    // Two morning stops, then an any-time stop right next to the office. By
    // distance alone it would go first and make the tight 08:00-08:40 stop late.
    const stops = [
      stop("tight", 40.36, -111.75, { windowStart: "08:00", windowEnd: "08:40", durationMin: 30 }),
      stop("morning", 40.37, -111.76, { windowStart: "08:00", windowEnd: "12:00", durationMin: 30 }),
      stop("any", OREM.lat + 0.001, OREM.lng + 0.001, { durationMin: 45 }),
    ];
    const ordered = orderStops(stops, OREM, { dayStart: "08:00" });
    const t = timings(ordered, legsFor(ordered, OREM), "08:00");
    expect(t.filter((x) => x.late)).toEqual([]);
    expect(ordered.map((s) => s.id).indexOf("tight")).toBeLessThan(ordered.map((s) => s.id).indexOf("any"));
  });

  it("keeps the current order when it is already the best it can find", () => {
    const stops = [stop("a", 40.3, -111.7), stop("b", 40.31, -111.71), stop("c", 40.32, -111.72)];
    expect(orderStops(stops, { lat: 40.29, lng: -111.69 }, { dayStart: "08:00" }).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});

describe("route checks", () => {
  const leg = (toId: string, minutes: number): Leg => ({ fromId: null, toId, meters: minutes * 600, seconds: minutes * 60 });

  it("FR-DSP-06: flags a leg more than 3x the median", () => {
    expect([...flaggedStops([leg("a", 5), leg("b", 6), leg("c", 4), leg("d", 31)])]).toEqual(["d"]);
    expect([...flaggedStops([leg("a", 5), leg("b", 6), leg("c", 15)])]).toEqual([]);
    expect([...flaggedStops([leg("a", 1), leg("b", 30)])]).toEqual([]);
  });

  it("FR-DSP-06: catches a pin geocoded to the wrong city, and does not blame the stop after it", () => {
    const route = [stop("a", 40.29, -111.69), stop("b", 40.295, -111.695), stop("c", 40.3, -111.7), stop("wrong", 37.1, -113.58), stop("d", 40.305, -111.705)];
    expect([...flaggedStops(legsFor(route, OREM))]).toEqual(["wrong"]);
  });

  it("FR-DSP-06: a wrong pin first on the route is still the one flagged", () => {
    // A median needs a typical route under it: with two long legs out of four, long is typical.
    const near = [0, 1, 2, 3, 4].map((k) => stop(`n${k}`, 40.29 + k * 0.005, -111.69 - k * 0.005));
    expect([...flaggedStops(legsFor([stop("wrong", 37.1, -113.58), ...near], OREM))]).toEqual(["wrong"]);
  });

  it("waits for windows that have not opened and marks late arrivals", () => {
    const route = [stop("a", 40.3, -111.7, { windowStart: "09:00", windowEnd: "10:00" }), stop("b", 40.3, -111.7, { windowEnd: "09:15", durationMin: 20 })];
    const legs: Leg[] = [{ fromId: null, toId: "a", meters: 0, seconds: 600 }, { fromId: "a", toId: "b", meters: 0, seconds: 0 }];
    const t = timings(route, legs, "08:00");
    expect(t[0]).toMatchObject({ arrival: "09:00", waitMin: 50, late: false, departure: "09:30" });
    expect(t[1]).toMatchObject({ arrival: "09:30", late: true });
  });
});
