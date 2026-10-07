import { describe, expect, it } from "vitest";
import { commissionBasis, commissionFor } from "./commission";

describe("commission (FR-SAL-01)", () => {
  it("adds the flat amount to the percent of the first service", () => {
    expect(commissionFor({ flatCents: 2500, pct: 10 }, 19900)).toBe(4490);
    expect(commissionFor({ flatCents: 0, pct: 7.5 }, 19900)).toBe(1493);
    expect(commissionFor({ flatCents: 1500, pct: 0 }, 19900)).toBe(1500);
    expect(commissionFor({ flatCents: 0, pct: 0 }, 19900)).toBe(0);
  });

  it("earns on the first service price when the plan has one", () => {
    expect(commissionBasis({ priceCents: 12900, initialPriceCents: 19900 })).toBe(19900);
    expect(commissionBasis({ priceCents: 12900, initialPriceCents: null })).toBe(12900);
    expect(commissionBasis(null)).toBe(0);
  });
});
