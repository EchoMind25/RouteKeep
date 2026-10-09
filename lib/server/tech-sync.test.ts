import { afterEach, describe, expect, it, vi } from "vitest";

// NFR-01, D-04: the upload time budget.
const withRls = vi.fn();
vi.mock("@/lib/db/rls", () => ({ withRls: (...a: unknown[]) => withRls(...a) }));
vi.mock("@/lib/messaging/enqueue", () => ({ enqueueEmail: vi.fn() }));

import type { MemberSession } from "@/lib/auth/session";
import type { Mutation } from "@/lib/sync/protocol";
import { mutation as mutationSchema } from "@/lib/sync/protocol";
import { applyMutations, countDateAllowed, UPLOAD_BUDGET_MS } from "./tech-sync";

const member = { claims: {}, tenantId: "t", userId: "u" } as unknown as MemberSession;
const mutations = Array.from({ length: 50 }, (_, i) => ({ key: `k${i}`, kind: "arrive" }) as unknown as Mutation);

afterEach(() => {
  vi.useRealTimers();
  withRls.mockReset();
});

describe("applyMutations time budget (NFR-01)", () => {
  it("returns a prefix once the deadline passes and omits the rest", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let n = 0;
    withRls.mockImplementation(async () => {
      if (n++ === 0) return "tech-1"; // technician lookup
      vi.advanceTimersByTime(3_000); // each mutation takes 3 s
      return { key: `k${n - 2}`, status: "applied" };
    });
    const results = await applyMutations(member, mutations);
    // Started at 0, 3, 6 and 9 s; the 5th would start at 12 s, past the 10 s budget.
    expect(results.length).toBe(Math.floor(UPLOAD_BUDGET_MS / 3_000) + 1);
    expect(results.map((r) => r.key)).toEqual(mutations.slice(0, results.length).map((m) => m.key));
    expect(results.length).toBeLessThan(50);
  });

  it("always applies at least one, even past the deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let n = 0;
    withRls.mockImplementation(async () => {
      if (n++ === 0) return "tech-1";
      vi.advanceTimersByTime(60_000);
      return { key: "k0", status: "applied" };
    });
    expect(await applyMutations(member, mutations)).toHaveLength(1);
  });

  it("applies everything when fast", async () => {
    let n = 0;
    withRls.mockImplementation(async () => (n++ === 0 ? "tech-1" : { key: `k${n}`, status: "applied" }));
    expect(await applyMutations(member, mutations)).toHaveLength(50);
  });
});

describe("truck check (FR-INV-07)", () => {
  it("accepts today and yesterday only", () => {
    expect(countDateAllowed("2026-10-09", "2026-10-09")).toBe(true);
    expect(countDateAllowed("2026-10-08", "2026-10-09")).toBe(true);
    expect(countDateAllowed("2026-10-07", "2026-10-09")).toBe(false);
    expect(countDateAllowed("2026-10-10", "2026-10-09")).toBe(false);
  });

  const base = { kind: "stock_count", key: "count-12345678", date: "2026-10-09", at: "2026-10-09T14:00:00Z", locationId: "11111111-1111-4111-8111-111111111111" };
  const line = { productId: "22222222-2222-4222-8222-222222222222", qty: 2, unit: "gal" };
  it("validates the mutation shape per item", () => {
    expect(mutationSchema.safeParse({ ...base, lines: [line] }).success).toBe(true);
    expect(mutationSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(mutationSchema.safeParse({ ...base, lines: [{ ...line, qty: -1 }] }).success).toBe(false);
    expect(mutationSchema.safeParse({ ...base, lines: Array.from({ length: 201 }, () => line) }).success).toBe(false);
  });
});
