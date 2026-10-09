import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getMemberSession: vi.fn(), getUserSession: vi.fn() }));
vi.mock("@/lib/portal/session", () => ({ portalSession: vi.fn() }));
vi.mock("./track", () => ({ track: vi.fn(), warnOnce: vi.fn() }));

const { firstThisHour, resolveCaller } = await import("./server-error");

describe("OPS-04: server errors without a session", () => {
  it("are anonymous only on plain public pages", async () => {
    expect(await resolveCaller({ path: "/pricing", headers: {} })).toBe("anon");
  });
  it("are dropped on paths that belong to a business", async () => {
    for (const path of ["/p/11111111-2222-4333-8444-555555555555/pay", "/u/abc", "/api/webhooks/stripe", "/api/inngest", "/api/cron?job=billing"]) {
      expect(await resolveCaller({ path, headers: {} })).toBeNull();
    }
  });
});

describe("OPS-03: server error dedupe", () => {
  it("reports a fingerprint once an hour and caps the hour", () => {
    const t0 = 1_000_000_000;
    expect(firstThisHour("a", t0)).toBe(true);
    expect(firstThisHour("a", t0 + 1000)).toBe(false);
    for (let i = 0; i < 100; i++) firstThisHour(`f${i}`, t0 + 2000);
    expect(firstThisHour("late", t0 + 3000)).toBe(false);
    expect(firstThisHour("a", t0 + 3_600_000)).toBe(true);
  });
});
