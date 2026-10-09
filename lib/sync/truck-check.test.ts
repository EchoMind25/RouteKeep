import { describe, expect, it } from "vitest";
import { buildCountLines, parseCount } from "./truck-check";

// FR-INV-07: what the technician types becomes count lines.
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const products = [
  { productId: A, unit: "gal" as const },
  { productId: B, unit: "lb" as const },
];

describe("parseCount (FR-INV-07)", () => {
  it("accepts decimals and a decimal comma", () => {
    expect(parseCount("2.5")).toBe(2.5);
    expect(parseCount("2,5")).toBe(2.5);
    expect(parseCount("0")).toBe(0);
  });
  it("refuses negatives, junk and absurd values", () => {
    for (const bad of ["-1", "", "abc", "1e3", "1.2.3", "10000001"]) expect(parseCount(bad)).toBeNull();
  });
});

describe("buildCountLines (FR-INV-07)", () => {
  it("builds lines and treats not on truck as zero", () => {
    const r = buildCountLines(products, { [A]: { value: "3", notOnTruck: false }, [B]: { value: "", notOnTruck: true } });
    expect(r.errors).toEqual({});
    expect(r.lines).toEqual([
      { productId: A, qty: 3, unit: "gal" },
      { productId: B, qty: 0, unit: "lb" },
    ]);
  });
  it("blank without the toggle and bad numbers are errors", () => {
    const r = buildCountLines(products, { [A]: { value: "-2", notOnTruck: false } });
    expect(Object.keys(r.errors).sort()).toEqual([A, B]);
  });
});
