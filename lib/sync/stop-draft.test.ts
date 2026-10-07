import { describe, expect, it } from "vitest";
import type { SnapshotInfo } from "./client-store";
import type { SnapshotMix, SnapshotProduct, SnapshotStop } from "./protocol";
import { formatDeadline } from "@/lib/ui/format";
import { buildComplete, missingFields, newApplication, newDraft, paymentProblem, recordDue } from "./stop-draft";

const info: SnapshotInfo = {
  protocol: 1,
  generatedAt: "2026-10-07T13:00:00.000Z",
  today: "2026-10-07",
  days: ["2026-10-07", "2026-10-08"],
  technician: { id: "7ec00000-0000-4000-8000-000000000001", name: "Dez Whitlock", licenseNo: "UT-APP-1031", licenseExpiry: "2027-12-01" },
  business: { name: "Timpanogos Pest & Lawn", address: "1800 N Main St, Orem, UT 84057", licenseNo: "UT-BUS-4471", state: "UT", timezone: "America/Denver" },
  favorites: [],
};

const stop: SnapshotStop = {
  id: "a0000000-0000-4000-8000-000000000001", version: 1, date: "2026-10-07", number: 1, status: "scheduled", windowStart: "08:00", windowEnd: "12:00",
  durationMin: 30, customerId: "c1", customerName: "Marisol Quintero", phone: null, customerNotes: null, propertyId: "p1",
  address: "1450 S Sandhill Rd, Orem, UT 84058", lat: 40.28, lng: -111.69, accessNotes: null, visitNotes: null, serviceTypeId: "t1",
  serviceType: "General pest", checklist: ["Inspect perimeter", "Check bait stations"], isInitial: false, priceCents: 6900, sqFt: 1800,
  lawnSqFt: null, arrivedAt: null, completedAt: null,
};

const perimeter: SnapshotProduct = {
  id: "b0000000-0000-4000-8000-000000000001", name: "Demo Perimeter Concentrate", kind: "pesticide", epaRegNo: "0-101", signalWord: "caution",
  restrictedUse: false, activeIngredients: "Bifenthrin 7.9%", defaultAmountUnit: "gal", defaultMixRate: 0.5, defaultMixUnit: "fl_oz_per_gal",
};
const restricted: SnapshotProduct = { ...perimeter, id: "b0000000-0000-4000-8000-000000000002", name: "Demo RUP Fumigant", signalWord: "danger", restrictedUse: true };

const now = new Date("2026-10-07T15:20:00.000Z"); // 09:20 in Denver (MDT)

describe("stop flow rules", () => {
  it("FR-TEC-06: prefills from the last visit to the property, else from the product", () => {
    const last: SnapshotMix = {
      productId: perimeter.id, mixRate: 0.75, mixUnit: "fl_oz_per_gal", totalAmount: 2, amountUnit: "gal", areaTreated: 1900, areaUnit: "linear_ft",
      targetSites: ["Foundation perimeter"], targetPests: ["Ants"], appliedAt: "2026-07-07T15:00:00.000Z",
    };
    expect(newApplication(perimeter, last, now, "America/Denver")).toMatchObject({ mixRate: "0.75", totalAmount: "2", areaTreated: "1900", areaUnit: "linear_ft", targetPests: ["Ants"], appliedTime: "09:20" });
    expect(newApplication(perimeter, undefined, now, "America/Denver")).toMatchObject({ mixRate: "0.5", mixUnit: "fl_oz_per_gal", totalAmount: "", targetSites: [] });
  });

  it("FR-TEC-07: names exactly which record fields are missing, per product", () => {
    const draft = { ...newDraft(stop, now), applications: [newApplication(perimeter, undefined, now, "America/Denver")] };
    expect(missingFields(draft, stop, [perimeter], info)).toEqual([
      { key: draft.applications[0]!.key, productName: "Demo Perimeter Concentrate", fields: ["Total amount applied", "Area treated", "Target sites", "Target pests"] },
    ]);
  });

  it("FR-REC-05: a restricted-use Danger product needs the customer's statement", () => {
    const entry = { ...newApplication(restricted, undefined, now, "America/Denver"), totalAmount: "1", areaTreated: "200", targetSites: ["Crawlspace"], targetPests: ["Mice"] };
    const draft = { ...newDraft(stop, now), applications: [entry] };
    expect(missingFields(draft, stop, [restricted], info)[0]!.fields).toEqual(["Customer statement (restricted-use Danger product)"]);
    expect(missingFields({ ...draft, applications: [{ ...entry, customerStatement: true }] }, stop, [restricted], info)).toEqual([]);
  });

  it("payment: cash needs an amount, a check needs its number", () => {
    const draft = newDraft(stop, now);
    expect(draft.payment).toMatchObject({ method: "invoice_later", amount: "69.00" });
    expect(paymentProblem(draft)).toBeNull();
    expect(paymentProblem({ ...draft, payment: { ...draft.payment, method: "cash", amount: "" } })).toBe("Enter the amount collected");
    expect(paymentProblem({ ...draft, payment: { ...draft.payment, method: "check", amount: "69" } })).toBe("Enter the check number");
  });

  it("builds the upload: numbers, the applied time in the business's zone, the checklist and the payment", () => {
    const entry = { ...newApplication(perimeter, undefined, now, "America/Denver"), totalAmount: "1.5", areaTreated: "1800", areaUnit: "linear_ft", targetSites: ["Foundation perimeter"], targetPests: ["Ants", "Spiders"], appliedTime: "09:05" };
    const draft = { ...newDraft(stop, now), checklist: { "Inspect perimeter": true, "Check bait stations": false }, notes: " Webs under the eaves ", applications: [entry], payment: { method: "check" as const, amount: "69", checkNumber: "1042", key: "pay-check-0001" } };
    const m = buildComplete(draft, stop, info, now);
    expect(m).toMatchObject({
      kind: "complete",
      appointmentId: stop.id,
      date: "2026-10-07",
      notes: "Webs under the eaves",
      checklist: [{ label: "Inspect perimeter", done: true }, { label: "Check bait stations", done: false }],
      payment: { method: "check", key: "pay-check-0001", amountCents: 6900, checkNumber: "1042" },
    });
    expect(m.applications[0]).toMatchObject({ mixRate: 0.5, totalAmount: 1.5, areaTreated: 1800, appliedAt: "2026-10-07T15:05:00.000Z", customerStatementAt: null });
  });
});

describe("record deadline on the phone (CR-02)", () => {
  const tz = "America/Denver";
  const hours = (n: number) => new Date(now.getTime() + n * 3_600_000);

  it("starts at arrival and warns from 20 hours", () => {
    const draft = newDraft(stop, now);
    expect(recordDue(stop, undefined, tz, now)).toBeNull();
    expect(recordDue(stop, draft, tz, hours(19.9))).toMatchObject({ warn: false, overdue: false, due: hours(24) });
    expect(recordDue(stop, draft, tz, hours(20))).toMatchObject({ warn: true, overdue: false });
    expect(recordDue(stop, draft, tz, hours(24))).toMatchObject({ warn: false, overdue: true });
  });

  it("counts from an application time entered as earlier than arrival", () => {
    const draft = newDraft(stop, now);
    const entry = { ...newApplication(perimeter, undefined, now, tz), appliedTime: "08:05" };
    expect(recordDue(stop, { ...draft, applications: [entry] }, tz, now)!.due).toEqual(new Date("2026-10-08T14:05:00.000Z"));
  });

  it("uses an arrival the office already has, and stops once the stop is finished here", () => {
    const arrived = { ...stop, status: "in_progress", arrivedAt: "2026-10-06T18:00:00.000Z" };
    expect(recordDue(arrived, undefined, tz, now)).toMatchObject({ warn: true, due: new Date("2026-10-07T18:00:00.000Z") });
    expect(recordDue(arrived, { ...newDraft(arrived, now), completedAt: now.toISOString() }, tz, now)).toBeNull();
    expect(recordDue({ ...arrived, status: "completed" }, undefined, tz, now)).toBeNull();
    expect(recordDue({ ...arrived, status: "skipped" }, undefined, tz, now)).toBeNull();
  });

  it("says the deadline on the business's clock", () => {
    expect(formatDeadline(new Date("2026-10-07T18:00:00.000Z"), tz, now)).toBe("12:00 PM");
    expect(formatDeadline(new Date("2026-10-08T14:05:00.000Z"), tz, now)).toBe("Thu 8:05 AM");
  });
});
