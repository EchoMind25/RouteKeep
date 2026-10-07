import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ContactError, formatAddress, formatPhone, normalizeEmail, normalizeUsPhone } from "./contact";
import { planGeneration, type SubscriptionForGeneration } from "./generation";
import { centsToInput, formatCents, MoneyError, parseMoneyToCents } from "./money";
import { CR01_FIELDS, isRecordEditable, missingRecordFields, recordDeadline, recordTiming, requiresCustomerStatement, type ApplicationDraft } from "./records";
import { parseLocalDate as d, parseLocalTime as t } from "./time";
import { AMOUNT_UNITS, AREA_UNITS, convert, MIX_UNITS, mixPreview, productNeeded, UnitError, type AmountUnit } from "./units";

const migrationsDir = join(__dirname, "..", "..", "supabase", "migrations");
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
  .join("\n");

function checkList(column: string): string[] {
  const m = new RegExp(`${column} text check \\(${column} in \\(([^)]*)\\)\\)`).exec(migrations);
  if (!m) throw new Error(`no CHECK list for ${column}`);
  return m[1]!.split(",").map((s) => s.trim().replace(/^'|'$/g, "").replace(/\s+/g, ""));
}

describe("money", () => {
  it.each([
    ["129", 12900],
    ["129.9", 12990],
    ["129.90", 12990],
    ["$1,299.00", 129900],
    ["0.07", 7],
    [" 45 ", 4500],
  ])("parses %j as %i cents", (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents);
  });

  it.each(["", "12.345", "-5", "1,29", "abc", "1e3"])("refuses %j", (input) => {
    expect(() => parseMoneyToCents(input)).toThrow(MoneyError);
  });

  it("round-trips any amount through the form field without float drift", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_000_000_000 }), (cents) => {
        expect(parseMoneyToCents(centsToInput(cents))).toBe(cents);
        expect(parseMoneyToCents(formatCents(cents))).toBe(cents);
      }),
    );
  });
});

describe("units and mix rates (R-BUG-07)", () => {
  it("keeps the unit lists identical to the database CHECK constraints", () => {
    expect(checkList("amount_unit")).toEqual([...AMOUNT_UNITS]);
    expect(checkList("mix_unit")).toEqual([...MIX_UNITS]);
    expect(checkList("area_unit")).toEqual([...AREA_UNITS]);
  });

  it("converts within a dimension and refuses across dimensions", () => {
    expect(convert({ value: 1, unit: "gal" }, "fl_oz").value).toBeCloseTo(128, 9);
    expect(convert({ value: 1, unit: "lb" }, "oz").value).toBeCloseTo(16, 9);
    expect(() => convert({ value: 1, unit: "gal" }, "lb")).toThrow(UnitError);
  });

  it("round-trips every conversion", () => {
    const volume: AmountUnit[] = ["fl_oz", "gal", "ml", "l"];
    const mass: AmountUnit[] = ["oz", "lb", "g", "kg"];
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1e6, noNaN: true }),
        fc.constantFrom(volume, mass),
        fc.nat(3),
        fc.nat(3),
        (value, group, i, j) => {
          const a = group[i]!;
          const b = group[j]!;
          const back = convert(convert({ value, unit: a }, b), a).value;
          expect(Math.abs(back - value) / value).toBeLessThan(1e-12);
        },
      ),
    );
  });

  it("reads percent as percent: 0.06% of 1 gal is about 0.077 fl oz, not 7.68", () => {
    const product = productNeeded({ rate: 0.06, unit: "pct" }, { finishedMix: { value: 1, unit: "gal" } });
    expect(product.unit).toBe("fl_oz");
    expect(product.value).toBeCloseTo(0.0768, 6);
    expect(() => productNeeded({ rate: 150, unit: "pct" }, { finishedMix: { value: 1, unit: "gal" } })).toThrow(UnitError);
  });

  it("computes per-gallon and per-area rates", () => {
    expect(productNeeded({ rate: 0.5, unit: "fl_oz_per_gal" }, { finishedMix: { value: 1.5, unit: "gal" } }).value).toBeCloseTo(0.75);
    expect(productNeeded({ rate: 3, unit: "lb_per_1000_sq_ft" }, { area: { value: 5500, unit: "sq_ft" } }).value).toBeCloseTo(16.5);
    expect(productNeeded({ rate: 130, unit: "lb_per_acre" }, { area: { value: 0.5, unit: "acre" } }).value).toBeCloseTo(65);
    expect(() => productNeeded({ rate: 3, unit: "lb_per_1000_sq_ft" }, { area: { value: 200, unit: "linear_ft" } })).toThrow(UnitError);
    expect(() => productNeeded({ rate: 0, unit: "fl_oz_per_gal" }, { finishedMix: { value: 1, unit: "gal" } })).toThrow(UnitError);
  });

  it("scales linearly with the amount applied", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 50, noNaN: true }),
        fc.double({ min: 0.1, max: 500, noNaN: true }),
        fc.double({ min: 1.5, max: 10, noNaN: true }),
        (rate, gallons, k) => {
          const base = productNeeded({ rate, unit: "fl_oz_per_gal" }, { finishedMix: { value: gallons, unit: "gal" } }).value;
          const scaled = productNeeded({ rate, unit: "fl_oz_per_gal" }, { finishedMix: { value: gallons * k, unit: "gal" } }).value;
          expect(scaled / base).toBeCloseTo(k, 9);
        },
      ),
    );
  });

  it("explains the mix in words the technician can check", () => {
    expect(mixPreview({ rate: 0.5, unit: "fl_oz_per_gal" }, { finishedMix: { value: 1.5, unit: "gal" } })).toBe(
      "0.75 fl oz of product in 1.5 gal of mix",
    );
    expect(mixPreview({ rate: 0.06, unit: "pct" }, { finishedMix: { value: 2, unit: "gal" } })).toBe(
      "0.154 fl oz of product in 2 gal of mix (0.06% means 0.001 of every unit)",
    );
  });
});

describe("application records (CR-01)", () => {
  const complete: ApplicationDraft = {
    productId: "p",
    technicianId: "t",
    customerName: "Marisol Quintero",
    customerAddress: "1450 S Sandhill Rd, Orem, UT 84058",
    applicationAddress: "1450 S Sandhill Rd, Orem, UT 84058",
    businessName: "Wasatch Front Pest",
    businessAddress: "100 N University Ave, Provo, UT 84601",
    businessLicenseNo: "BL-1",
    applicatorName: "Dez Whitlock",
    applicatorLicenseNo: "UT-0042",
    productName: "Perimeter concentrate",
    productKind: "pesticide",
    epaRegNo: "1000-1",
    mixRate: 0.5,
    mixUnit: "fl_oz_per_gal",
    totalAmount: 1.5,
    amountUnit: "gal",
    areaTreated: 1800,
    areaUnit: "linear_ft",
    targetSites: ["foundation perimeter"],
    targetPests: ["ants"],
    appliedAt: new Date(),
  };

  it("accepts a complete record", () => {
    expect(missingRecordFields(complete)).toEqual([]);
  });

  it("names exactly what is missing (FR-TEC-07)", () => {
    expect(missingRecordFields({ ...complete, epaRegNo: null, targetPests: [" "], areaTreated: 0 })).toEqual([
      "Area treated",
      "Target pests",
      "EPA registration number",
    ]);
    expect(missingRecordFields({ ...complete, productKind: "fertilizer", epaRegNo: null })).toEqual([]);
  });

  it("asks for the customer statement before restricted-use Danger products (FR-REC-05)", () => {
    const rup = { ...complete, restrictedUse: true, signalWord: "danger" as const };
    expect(requiresCustomerStatement(rup)).toBe(true);
    expect(missingRecordFields(rup)).toEqual(["Customer statement (restricted-use Danger product)"]);
    expect(missingRecordFields({ ...rup, customerStatementAt: new Date() })).toEqual([]);
    expect(requiresCustomerStatement({ restrictedUse: true, signalWord: "caution" })).toBe(false);
  });

  it("checks the same columns as the database constraint", () => {
    const constraint = /constraint cr01_complete check \(([\s\S]*?)\n  \),/.exec(migrations)![1]!;
    for (const field of CR01_FIELDS) {
      expect(constraint, `${field.column} missing from cr01_complete`).toContain(field.column);
    }
    expect(constraint).toContain("epa_reg_no");
  });

  it("warns at 20 hours and locks at 24 (CR-02, DB-08)", () => {
    const applied = new Date("2026-10-06T15:00:00Z");
    expect(recordDeadline(applied, new Date("2026-10-07T10:00:00Z"))).toMatchObject({ warn: false, overdue: false });
    expect(recordDeadline(applied, new Date("2026-10-07T11:30:00Z"))).toMatchObject({ warn: true, overdue: false });
    expect(recordDeadline(applied, new Date("2026-10-07T15:00:00Z"))).toMatchObject({ overdue: true, due: new Date("2026-10-07T15:00:00Z") });
    expect(isRecordEditable(applied, new Date("2026-10-07T14:59:00Z"))).toBe(true);
    expect(isRecordEditable(applied, new Date("2026-10-07T15:00:00Z"))).toBe(false);
  });
});

describe("record timing (CR-02)", () => {
  const applied = new Date("2026-10-06T15:00:00Z");
  const base = { appliedAt: applied, capturedAt: applied, recordedAt: new Date("2026-10-09T08:00:00Z"), imported: false, amendedFrom: null };

  it("measures a phone's record from when the stop was finished, not when it uploaded", () => {
    const timing = recordTiming({ ...base, visitCompletedAt: new Date("2026-10-06T16:30:00Z") });
    expect(timing).toMatchObject({ hoursAfter: 1.5, late: false, madeAt: new Date("2026-10-06T16:30:00Z") });
  });

  it("flags a record finished more than 24 hours after the application", () => {
    expect(recordTiming({ ...base, visitCompletedAt: new Date("2026-10-07T15:30:00Z") })).toMatchObject({ late: true });
  });

  it("falls back to when the server stored it, and skips imports and amendments", () => {
    expect(recordTiming({ ...base, capturedAt: null, visitCompletedAt: new Date("2026-10-06T16:00:00Z") })).toMatchObject({ hoursAfter: 65, late: true });
    expect(recordTiming({ ...base, visitCompletedAt: null })).toMatchObject({ late: true });
    expect(recordTiming({ ...base, visitCompletedAt: null, imported: true })).toBeNull();
    expect(recordTiming({ ...base, visitCompletedAt: null, amendedFrom: "00000000-0000-4000-8000-000000000001" })).toBeNull();
    expect(recordTiming({ ...base, appliedAt: null, visitCompletedAt: null })).toBeNull();
  });
});

describe("contact details", () => {
  it.each([
    ["(801) 555-0142", "+18015550142"],
    ["801.555.0142", "+18015550142"],
    ["+1 801 555 0142", "+18015550142"],
    ["1-801-555-0142", "+18015550142"],
  ])("normalises %j", (input, e164) => {
    expect(normalizeUsPhone(input)).toBe(e164);
  });

  it.each(["555-0142", "(101) 555-0142", "801-555-01422", "call me"])("refuses %j", (input) => {
    expect(() => normalizeUsPhone(input)).toThrow(ContactError);
  });

  it("formats for people", () => {
    expect(formatPhone("+18015550142")).toBe("(801) 555-0142");
    expect(normalizeEmail("  Marisol@Example.COM ")).toBe("marisol@example.com");
    expect(formatAddress({ line1: "1450 S Sandhill Rd", line2: "", city: "Orem", region: "UT", postalCode: "84058" })).toBe(
      "1450 S Sandhill Rd, Orem, UT 84058",
    );
  });
});

describe("appointment generation (FR-SUB-02)", () => {
  const sub: SubscriptionForGeneration = {
    id: "sub-1",
    status: "active",
    startDate: d("2026-10-14"),
    rrule: "FREQ=MONTHLY",
    priceCents: 6900,
    initialPriceCents: 14900,
    durationMin: 30,
    generatedThrough: null,
    pausedFrom: null,
    pausedUntil: null,
    preferredTechnicianId: "tech-1",
    preferredWindowStart: t("08:00"),
    preferredWindowEnd: t("12:00"),
  };

  it("creates the initial visit at the initial price, then 60 days ahead", () => {
    const plan = planGeneration(sub, d("2026-10-06"));
    // Horizon: 2026-10-06 + 60 days = 2026-12-05, so December's visit is not created yet.
    expect(plan.visits.map((v) => [v.localDate, v.priceCents, v.isInitial])).toEqual([
      ["2026-10-14", 14900, true],
      ["2026-11-14", 6900, false],
    ]);
    expect(plan.generatedThrough).toBe("2026-12-05");
    expect(plan.visits[0]).toMatchObject({ technicianId: "tech-1", windowStart: "08:00", windowEnd: "12:00" });
  });

  it("continues where the last run stopped and never repeats a date", () => {
    const first = planGeneration(sub, d("2026-10-06"));
    const sameDay = planGeneration({ ...sub, generatedThrough: first.generatedThrough }, d("2026-10-06"));
    expect(sameDay.visits).toEqual([]);
    const second = planGeneration({ ...sub, generatedThrough: first.generatedThrough }, d("2026-10-20"));
    expect(second.visits.map((v) => v.localDate)).toEqual(["2026-12-14"]);
    const third = planGeneration({ ...sub, generatedThrough: second.generatedThrough }, d("2026-11-20"));
    expect(third.visits.map((v) => v.localDate)).toEqual(["2027-01-14"]);
  });

  it("produces the same set however often it runs (idempotent with the occurrence key)", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 15 }), (gaps) => {
        let through: string | null = null;
        let today = d("2026-10-06");
        const seen = new Set<string>();
        for (const gap of gaps) {
          const plan = planGeneration({ ...sub, generatedThrough: through as never }, today);
          for (const v of plan.visits) {
            expect(seen.has(v.occurrenceDate)).toBe(false);
            seen.add(v.occurrenceDate);
          }
          through = plan.generatedThrough ?? through;
          today = d(new Date(Date.parse(today) + gap * 86_400_000).toISOString().slice(0, 10));
        }
      }),
    );
  });

  it("does nothing for cancelled plans and skips paused windows", () => {
    expect(planGeneration({ ...sub, status: "cancelled" }, d("2026-10-06")).visits).toEqual([]);
    const paused = planGeneration({ ...sub, status: "paused", pausedFrom: d("2026-11-01"), pausedUntil: d("2026-11-30") }, d("2026-10-06"), 90);
    expect(paused.visits.map((v) => v.localDate)).toEqual(["2026-10-14", "2026-12-14"]);
    const open = planGeneration({ ...sub, status: "paused", pausedFrom: d("2026-11-01"), pausedUntil: null }, d("2026-10-06"));
    expect(open.visits.map((v) => v.localDate)).toEqual(["2026-10-14"]);
    expect(open.generatedThrough).toBe("2026-10-31");
  });

  it("never creates visits in the past", () => {
    const plan = planGeneration({ ...sub, startDate: d("2026-08-14") }, d("2026-10-06"));
    expect(plan.visits.map((v) => v.localDate)).toEqual(["2026-10-14", "2026-11-14"]);
    expect(plan.visits.some((v) => v.isInitial)).toBe(false);
  });
});
