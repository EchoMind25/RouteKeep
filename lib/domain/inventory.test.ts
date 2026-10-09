import { describe, expect, it } from "vitest";
import {
  bucketForecast, forecastBetween, forecastBuckets, forecastByDay, nextOrderDate, normalizePest, onHand, orderTotal, pestTrend, productUsed,
  stockUnitFor, suggestResupply, usageOutliers, usageRates, weeklyAverages, weekStart,
  type CompletedVisit, type PestSighting, type StockMove, type UseRecord,
} from "./inventory";
import { addDays, parseLocalDate as d, type LocalDate } from "./time";

const at = (s: string) => new Date(`${s}Z`);

describe("productUsed (FR-INV-02)", () => {
  it("turns finished mix back into concentrate: 1 gal at 0.5 fl oz per gal is 0.5 fl oz", () => {
    expect(productUsed({ mixRate: 0.5, mixUnit: "fl_oz_per_gal", totalAmount: 1, amountUnit: "gal" }, "fl_oz")).toBeCloseTo(0.5, 9);
    expect(productUsed({ mixRate: 0.5, mixUnit: "pct", totalAmount: 2, amountUnit: "gal" }, "fl_oz")).toBeCloseTo(1.28, 9);
  });

  it("sums mixed units in the stock unit", () => {
    const a = productUsed({ mixRate: 0.5, mixUnit: "fl_oz_per_gal", totalAmount: 1, amountUnit: "gal" }, "fl_oz")!;
    const b = productUsed({ mixRate: 8, mixUnit: "ml_per_l", totalAmount: 2, amountUnit: "l" }, "fl_oz")!;
    expect(b).toBeCloseTo(16 / 29.5735295625, 9);
    expect(a + b).toBeCloseTo(0.5 + 16 / 29.5735295625, 9);
    expect(productUsed({ mixRate: 8, mixUnit: "ml_per_l", totalAmount: 2, amountUnit: "l" }, "ml")).toBeCloseTo(16, 9);
  });

  it("uses total amount as the product itself for area rates and converts it", () => {
    expect(productUsed({ mixRate: 2, mixUnit: "lb_per_1000_sq_ft", totalAmount: 8, amountUnit: "lb" }, "oz")).toBeCloseTo(128, 6);
    expect(productUsed({ mixRate: 2, mixUnit: "lb_per_1000_sq_ft", totalAmount: 1, amountUnit: "kg" }, "g")).toBeCloseTo(1000, 6);
  });

  it("never sums volume and mass: a mismatch is null, not zero", () => {
    expect(productUsed({ mixRate: 2, mixUnit: "lb_per_1000_sq_ft", totalAmount: 8, amountUnit: "lb" }, "fl_oz")).toBeNull();
    expect(productUsed({ mixRate: 0.5, mixUnit: "fl_oz_per_gal", totalAmount: 1, amountUnit: "gal" }, "lb")).toBeNull();
    // finished mix measured by weight is not a mix
    expect(productUsed({ mixRate: 0.5, mixUnit: "fl_oz_per_gal", totalAmount: 1, amountUnit: "lb" }, "fl_oz")).toBeNull();
  });

  it("returns null for missing or invalid data", () => {
    expect(productUsed({ mixRate: null, mixUnit: "pct", totalAmount: 1, amountUnit: "gal" }, "fl_oz")).toBeNull();
    expect(productUsed({ mixRate: 1, mixUnit: null, totalAmount: 1, amountUnit: "gal" }, "fl_oz")).toBeNull();
    expect(productUsed({ mixRate: 1, mixUnit: "pct", totalAmount: null, amountUnit: "gal" }, "fl_oz")).toBeNull();
    expect(productUsed({ mixRate: 0, mixUnit: "pct", totalAmount: 1, amountUnit: "gal" }, "fl_oz")).toBeNull();
    expect(productUsed({ mixRate: 1, mixUnit: "bogus", totalAmount: 1, amountUnit: "gal" }, "fl_oz")).toBeNull();
  });
});

describe("stockUnitFor", () => {
  it("prefers the setting, then the default mix's product unit, then the default amount unit", () => {
    expect(stockUnitFor({ stockUnit: "gal", defaultMixUnit: "fl_oz_per_gal", defaultAmountUnit: "oz" })).toBe("gal");
    expect(stockUnitFor({ stockUnit: null, defaultMixUnit: "fl_oz_per_gal", defaultAmountUnit: "gal" })).toBe("fl_oz");
    expect(stockUnitFor({ stockUnit: null, defaultMixUnit: null, defaultAmountUnit: "lb" })).toBe("lb");
    expect(stockUnitFor({ stockUnit: null, defaultMixUnit: null, defaultAmountUnit: null })).toBeNull();
  });
});

describe("onHand (FR-INV-06)", () => {
  const move = (kind: StockMove["kind"], qty: number, when: string, unit: StockMove["unit"] = "fl_oz"): StockMove => ({ kind, qty, unit, at: at(when) });

  it("starts at zero with no count and subtracts usage", () => {
    const r = onHand([move("receive", 100, "2026-10-01T10:00:00")], [{ qty: 12, at: at("2026-10-02T10:00:00") }], "fl_oz");
    expect(r).toEqual({ qty: 88, countedAt: null, skipped: 0 });
  });

  it("a count resets the baseline: earlier movements and usage no longer matter", () => {
    const moves = [move("receive", 500, "2026-10-01T10:00:00"), move("count", 96, "2026-10-06T14:00:00"), move("transfer_in", 32, "2026-10-07T10:00:00"), move("adjust", -2, "2026-10-07T11:00:00")];
    const uses = [{ qty: 400, at: at("2026-10-03T10:00:00") }, { qty: 10, at: at("2026-10-08T10:00:00") }];
    const r = onHand(moves, uses, "fl_oz");
    expect(r.qty).toBe(116);
    expect(r.countedAt).toEqual(at("2026-10-06T14:00:00"));
  });

  it("uses the latest of several counts", () => {
    const moves = [move("count", 50, "2026-10-01T10:00:00"), move("count", 20, "2026-10-08T10:00:00"), move("receive", 5, "2026-10-09T10:00:00")];
    expect(onHand(moves, [], "fl_oz").qty).toBe(25);
  });

  it("a transfer moves stock between two locations without changing the total", () => {
    const out = [move("count", 40, "2026-10-01T10:00:00"), move("transfer_out", -15, "2026-10-02T10:00:00")];
    const inn = [move("count", 0, "2026-10-01T10:00:00"), move("transfer_in", 15, "2026-10-02T10:00:00")];
    const shop = onHand(out, [], "fl_oz").qty;
    const truck = onHand(inn, [], "fl_oz").qty;
    expect(shop).toBe(25);
    expect(truck).toBe(15);
    expect(shop + truck).toBe(40);
  });

  it("converts movements into the stock unit and skips what cannot be converted", () => {
    const r = onHand([move("receive", 1, "2026-10-01T10:00:00", "gal"), move("receive", 5, "2026-10-01T11:00:00", "lb")], [], "fl_oz");
    expect(r.qty).toBeCloseTo(128, 3);
    expect(r.skipped).toBe(1);
  });

  it("FR-INV-06: a pair never counted starts at the location's creation, not at minus infinity", () => {
    const since = at("2026-10-01T00:00:00");
    const uses = [{ qty: 500, at: at("2026-09-01T10:00:00") }, { qty: 12, at: at("2026-10-02T10:00:00") }];
    const moves = [move("receive", 100, "2026-10-01T00:00:00"), move("receive", 999, "2026-09-30T23:59:59")];
    expect(onHand(moves, uses, "fl_oz", { since }).qty).toBe(88);
    expect(onHand(moves, uses, "fl_oz").qty).toBe(100 + 999 - 512);
  });

  it("FR-INV-06: a count wins a tie at its instant; of two counts at one instant the later created wins", () => {
    const t = "2026-10-06T14:00:00";
    const withTie = [{ ...move("count", 50, t), seq: "a" }, { ...move("receive", 7, t), seq: "b" }, move("receive", 3, "2026-10-06T14:00:01")];
    expect(onHand(withTie, [{ qty: 4, at: at(t) }], "fl_oz").qty).toBe(53);
    const twoCounts = [{ ...move("count", 10, t), seq: "2026-10-06 14:00:00+00 a" }, { ...move("count", 20, t), seq: "2026-10-06 14:00:00.5+00 b" }];
    expect(onHand(twoCounts, [], "fl_oz").qty).toBe(20);
    expect(onHand([...twoCounts].reverse(), [], "fl_oz").qty).toBe(20);
  });

  it("FR-INV-06: sub-millisecond ordering is kept", () => {
    const t = at("2026-10-06T14:00:00");
    const moves = [{ ...move("count", 10, "2026-10-06T14:00:00"), micros: 100 }, { ...move("receive", 5, "2026-10-06T14:00:00"), micros: 200 }];
    expect(onHand(moves, [], "fl_oz").qty).toBe(15);
    expect(onHand([{ ...moves[0]!, micros: 300 }, moves[1]!], [], "fl_oz").qty).toBe(10);
    expect(t).toBeInstanceOf(Date);
  });

  it("gives the expected quantity at an instant, for the count's variance", () => {
    const moves = [move("count", 100, "2026-10-01T10:00:00"), move("receive", 50, "2026-10-05T10:00:00")];
    const uses = [{ qty: 30, at: at("2026-10-04T10:00:00") }, { qty: 20, at: at("2026-10-07T10:00:00") }];
    expect(onHand(moves, uses, "fl_oz", { asOf: at("2026-10-06T00:00:00") }).qty).toBe(120);
    expect(onHand(moves, uses, "fl_oz").qty).toBe(100);
  });
});

describe("usage rates and fallback windows (FR-INV-03)", () => {
  const today = d("2026-10-09");
  const visits = (n: number, from: LocalDate, type = "t1"): CompletedVisit[] => Array.from({ length: n }, (_, i) => ({ localDate: addDays(from, i % 7), serviceTypeId: type }));
  const useOn = (qty: number, date: LocalDate, type = "t1", productId = "p1"): UseRecord => ({ localDate: date, serviceTypeId: type, productId, qty });

  it("uses the last 8 weeks when there are 10 visits", () => {
    const v = visits(10, d("2026-09-20"));
    const { bases, rates } = usageRates(v, [useOn(30, d("2026-09-21")), useOn(10, d("2026-09-22"))], today);
    expect(bases).toEqual([{ serviceTypeId: "t1", windowWeeks: 8, visits: 10, enough: true }]);
    expect(rates[0]!.perVisit).toBe(4);
  });

  it("falls back to 26 weeks when 8 weeks has fewer than 10 visits", () => {
    const v = [...visits(4, d("2026-09-20")), ...visits(8, d("2026-06-01"))];
    const { bases, rates } = usageRates(v, [useOn(24, d("2026-06-02")), useOn(24, d("2026-09-21"))], today);
    expect(bases[0]).toMatchObject({ windowWeeks: 26, visits: 12, enough: true });
    expect(rates[0]!.perVisit).toBe(4);
  });

  it("gives no rate, only a visit count, under 10 visits even over 26 weeks", () => {
    const { bases, rates } = usageRates(visits(9, d("2026-09-20")), [useOn(9, d("2026-09-21"))], today);
    expect(bases[0]).toEqual({ serviceTypeId: "t1", windowWeeks: 26, visits: 9, enough: false });
    expect(rates).toEqual([]);
  });

  it("ignores visits older than 26 weeks", () => {
    const { bases } = usageRates(visits(20, d("2026-03-01")), [], today);
    expect(bases[0]!.visits).toBe(0);
  });

  it("forecasts by day from scheduled groups and reports visits with no rate", () => {
    const { rates } = usageRates(visits(10, d("2026-09-20")), [useOn(40, d("2026-09-21"))], today);
    const { rows, unforecastVisits } = forecastByDay(
      [
        { localDate: d("2026-10-12"), serviceTypeId: "t1", technicianId: "a", visits: 3 },
        { localDate: d("2026-10-12"), serviceTypeId: "t1", technicianId: "b", visits: 1 },
        { localDate: d("2026-10-13"), serviceTypeId: "other", technicianId: "a", visits: 2 },
      ],
      rates,
    );
    expect(rows.map((r) => [r.technicianId, r.qty])).toEqual([["a", 12], ["b", 4]]);
    expect(unforecastVisits).toBe(2);
  });
});

describe("weeks and buckets (ENG-05)", () => {
  it("weeks run Monday to Sunday", () => {
    expect(weekStart(d("2026-10-09"))).toBe("2026-10-05"); // Friday
    expect(weekStart(d("2026-10-11"))).toBe("2026-10-05"); // Sunday
    expect(weekStart(d("2026-10-12"))).toBe("2026-10-12");
  });

  it("buckets this week from today, three more weeks, and the rest of the month", () => {
    const b = forecastBuckets(d("2026-10-09"));
    expect(b.map((x) => [x.key, x.from, x.to])).toEqual([
      ["week0", "2026-10-09", "2026-10-11"],
      ["week1", "2026-10-12", "2026-10-18"],
      ["week2", "2026-10-19", "2026-10-25"],
      ["week3", "2026-10-26", "2026-11-01"],
      ["month", "2026-10-09", "2026-10-31"],
    ]);
    const rows = [
      { localDate: d("2026-10-10"), productId: "p", technicianId: null, qty: 1 },
      { localDate: d("2026-10-12"), productId: "p", technicianId: null, qty: 2 },
      { localDate: d("2026-11-01"), productId: "p", technicianId: null, qty: 4 },
      { localDate: d("2026-11-02"), productId: "p", technicianId: null, qty: 8 },
    ];
    expect(bucketForecast(rows, b).get("p")).toEqual([1, 2, 0, 4, 3]);
  });

  it("averages full weeks only: last week and trailing 4, 8, 12", () => {
    const today = d("2026-10-09"); // current week starts 2026-10-05; last full week 09-28..10-04
    const uses = [
      { localDate: d("2026-10-06"), qty: 1000 }, // current week, ignored
      { localDate: d("2026-10-04"), qty: 10 },
      { localDate: d("2026-09-28"), qty: 10 },
      { localDate: d("2026-09-21"), qty: 20 },
      { localDate: d("2026-08-24"), qty: 48 }, // 6 weeks before the last full week
    ];
    const w = weeklyAverages(uses, today);
    expect(w.lastWeek).toBe(20);
    expect(w.avg4).toBe(10);
    expect(w.avg8).toBe((20 + 20 + 48) / 8);
    expect(w.avg12).toBe(88 / 12);
    expect(forecastBetween(uses, d("2026-10-05"), d("2026-10-04"))).toBe(0);
  });
});

describe("resupply suggestion (FR-INV-05)", () => {
  const flat = (from: LocalDate, days: number, perDay: number) => Array.from({ length: days }, (_, i) => ({ localDate: addDays(from, i), qty: perDay }));

  it("finds the order weekday across a week boundary", () => {
    // Friday 2026-10-09 with orders on Monday (1): next is Monday 10-12
    expect(nextOrderDate(d("2026-10-09"), [1])).toBe("2026-10-12");
    expect(nextOrderDate(d("2026-10-12"), [1])).toBe("2026-10-12");
    // Sunday (0) and Tuesday (2): from Friday, Sunday comes first
    expect(nextOrderDate(d("2026-10-09"), [2, 0])).toBe("2026-10-11");
    expect(nextOrderDate(d("2026-10-09"), [])).toBe("2026-10-09");
  });

  it("forecast mode: covers from today to the following order's arrival, packages rounded up", () => {
    // Friday; orders Mondays, 2 days lead: order Mon 10-12, arrives Wed 10-14, next arrives Wed 10-21, cover ends 10-20
    const s = suggestResupply({ mode: "forecast", today: d("2026-10-09"), orderWeekdays: [1], leadTimeDays: 2, packageQty: 128, safetyDays: 7, forecast: flat(d("2026-10-09"), 30, 10) });
    expect(s.orderDate).toBe("2026-10-12");
    expect(s.arrivalDate).toBe("2026-10-14");
    expect(s.coverEnd).toBe("2026-10-20");
    expect(s.need).toBe(120); // 10-09 .. 10-20 = 12 days
    expect(s.packages).toBe(1);
    expect(suggestResupply({ mode: "forecast", today: d("2026-10-09"), orderWeekdays: [1], leadTimeDays: 2, packageQty: 100, safetyDays: 7, forecast: flat(d("2026-10-09"), 30, 10) }).packages).toBe(2);
  });

  it("forecast mode: no order weekdays means any day and a 7 day cover", () => {
    const s = suggestResupply({ mode: "forecast", today: d("2026-10-09"), orderWeekdays: [], leadTimeDays: 3, packageQty: 50, safetyDays: 0, forecast: flat(d("2026-10-09"), 30, 10) });
    expect(s.orderDate).toBe("2026-10-09");
    expect(s.coverEnd).toBe("2026-10-18");
    expect(s.packages).toBe(Math.ceil(100 / 50));
  });

  it("exactly a whole number of packages does not round up", () => {
    const s = suggestResupply({ mode: "forecast", today: d("2026-10-09"), orderWeekdays: [], leadTimeDays: 0, packageQty: 70, safetyDays: 0, forecast: flat(d("2026-10-09"), 30, 10) });
    expect(s.need).toBe(70);
    expect(s.packages).toBe(1);
  });

  it("tracked mode: subtracts stock and open orders, adds safety stock, and says when to order", () => {
    const base = { mode: "tracked" as const, today: d("2026-10-09"), orderWeekdays: [1], leadTimeDays: 2, packageQty: 100, safetyDays: 3, forecast: flat(d("2026-10-09"), 60, 10) };
    // arrival 10-14: 5 days of use (10-09..10-13) = 50; cover 10-14..10-20 = 70; safety 30
    const none = suggestResupply({ ...base, onHand: 80 });
    expect(none.need).toBe(70 + 30 - (80 - 50));
    expect(none.packages).toBe(1);
    const covered = suggestResupply({ ...base, onHand: 80, openOrderQty: 200 });
    expect(covered.packages).toBe(0);
    // stock 80, safety 30: below safety once 6 days are used (10-14), minus 2 days lead = 10-12
    expect(none.orderBy).toBe("2026-10-12");
    expect(none.late).toBe(false);
    const late = suggestResupply({ ...base, onHand: 20 });
    expect(late.late).toBe(true);
    expect(late.orderBy).toBe("2026-10-09");
  });

  it("flags vendors under their minimum without padding", () => {
    expect(orderTotal([{ packages: 2, priceCents: 8900 }], 25000)).toEqual({ totalCents: 17800, unpriced: false, belowMinimum: true });
    expect(orderTotal([{ packages: 3, priceCents: 8900 }], 25000).belowMinimum).toBe(false);
    expect(orderTotal([{ packages: 1, priceCents: null }], 25000)).toEqual({ totalCents: 0, unpriced: true, belowMinimum: false });
  });
});

describe("outliers (FR-INV-11)", () => {
  const row = (technicianId: string, visits: number, qty: number) => ({ technicianId, serviceTypeId: "t", productId: "p", visits, qty });

  it("flags per-visit usage over 1.5x or under 0.5x the median", () => {
    const out = usageOutliers([row("a", 10, 100), row("b", 20, 200), row("c", 10, 200), row("d", 10, 40)]);
    expect(out.map((o) => [o.technicianId, o.direction])).toEqual([["d", "low"], ["c", "high"]]);
    expect(out.find((o) => o.technicianId === "c")!.median).toBe(10);
  });

  it("needs at least 10 visits and two technicians", () => {
    expect(usageOutliers([row("a", 9, 900), row("b", 10, 10), row("c", 10, 10)])).toEqual([]);
    expect(usageOutliers([row("a", 10, 900)])).toEqual([]);
  });
});

describe("pests (FR-INV-10)", () => {
  it("normalizes case, whitespace and synonyms", () => {
    expect(normalizePest("  pavement ANTS ")).toBe("Ants");
    expect(normalizePest("German roaches")).toBe("Cockroaches");
    expect(normalizePest("silverfish")).toBe("Silverfish");
    expect(normalizePest("   ")).toBeNull();
  });

  const sight = (zip: string, pest: string, date: string, id: string): PestSighting => ({ zip, pest, localDate: d(date), appointmentId: id });

  it("counts a visit once per pest and flags a rising ZIP", () => {
    const today = d("2026-10-09"); // full weeks end 10-04; recent4 = 09-07..10-04, prior4 = 08-10..09-06
    const s: PestSighting[] = [];
    for (let i = 0; i < 5; i++) s.push(sight("84058", "ants", "2026-08-12", `p${i}`));
    for (let i = 0; i < 8; i++) s.push(sight("84058", i % 2 ? "Pavement ants" : "Ants", "2026-09-15", `r${i}`));
    s.push(sight("84058", "Ants", "2026-09-15", "r0"), sight("84058", "pavement ants", "2026-09-15", "r0"));
    const trend = pestTrend(s, today);
    const ants = trend.find((t) => t.zip === "84058" && t.pest === "Ants")!;
    expect(ants.prior4).toBe(5);
    expect(ants.recent4).toBe(8);
    expect(ants.rising).toBe(true);
    expect(ants.weekly).toHaveLength(12);
  });

  it("does not flag small baselines or small rises", () => {
    const s: PestSighting[] = [];
    for (let i = 0; i < 4; i++) s.push(sight("84601", "Mice", "2026-08-12", `a${i}`));
    for (let i = 0; i < 20; i++) s.push(sight("84601", "Mice", "2026-09-15", `b${i}`));
    for (let i = 0; i < 10; i++) s.push(sight("84604", "Wasps", "2026-08-12", `c${i}`));
    for (let i = 0; i < 14; i++) s.push(sight("84604", "Wasps", "2026-09-15", `d${i}`));
    const trend = pestTrend(s, d("2026-10-09"));
    expect(trend.find((t) => t.pest === "Mice")!.rising).toBe(false); // baseline of 4 is under 5 visits
    expect(trend.find((t) => t.pest === "Wasps")!.rising).toBe(false); // up 40%
  });
});
