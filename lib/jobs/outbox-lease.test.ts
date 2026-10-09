import { describe, expect, it } from "vitest";
import { backoffMinutes, BATCH_SIZE, mapPool, nextBatchSize } from "./outbox-lease";

describe("outbox claim sizing (ENG-04)", () => {
  const base = { limit: 50, claimed: 0, startedAt: 1000, now: 1000, budgetMs: 8000 };
  it("claims a full batch, then only what is left under the limit", () => {
    expect(nextBatchSize(base)).toBe(BATCH_SIZE);
    expect(nextBatchSize({ ...base, claimed: 40 })).toBe(10);
    expect(nextBatchSize({ ...base, claimed: 50 })).toBe(0);
  });
  it("stops claiming once the time budget is spent", () => {
    expect(nextBatchSize({ ...base, now: 8999 })).toBe(BATCH_SIZE);
    expect(nextBatchSize({ ...base, now: 9000 })).toBe(0);
  });
});

describe("outbox backoff", () => {
  it("doubles and caps at four hours", () => {
    expect([1, 2, 3].map(backoffMinutes)).toEqual([2, 4, 8]);
    expect(backoffMinutes(20)).toBe(240);
  });
});

describe("mapPool (isolated sends, FR-MSG-05)", () => {
  it("never exceeds the concurrency and handles every item", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await mapPool([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      seen.push(n);
      active--;
    });
    expect(peak).toBe(4);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it("is fine with nothing to do", async () => {
    await mapPool([], 4, async () => {});
  });
});
