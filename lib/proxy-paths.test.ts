import { describe, expect, it } from "vitest";
import { NO_SESSION, STATIC_PUBLIC } from "./proxy-paths";

// FR-WEB-01, FR-WEB-04: the public pages skip the session refresh; nothing
// behind sign-in does.
describe("proxy paths", () => {
  it("skips the session on public pages and their files", () => {
    for (const p of ["/", "/pricing", "/switch", "/utah-pesticide-records", "/security", "/terms", "/status", "/robots.txt", "/opengraph-image", "/pricing/opengraph-image-15m7k7", "/api/cron", "/api/webhooks/stripe", "/p/acme", "/u/token"]) {
      expect(NO_SESSION.test(p), p).toBe(true);
    }
  });

  it("keeps the session on everything behind sign-in, and on look-alike paths", () => {
    for (const p of ["/app", "/sign-in", "/settings", "/settings/security", "/schedule", "/switchboard", "/pricing/x", "/developer", "/api/cronx", "/api/tech/sync", "/robotsxtxt"]) {
      expect(NO_SESSION.test(p), p).toBe(false);
    }
  });

  it("drops the nonce policy only on prerendered public pages", () => {
    for (const p of ["/", "/pricing", "/privacy"]) expect(STATIC_PUBLIC.test(p), p).toBe(true);
    for (const p of ["/status", "/sign-in", "/app", "/p/acme", "/schedule"]) expect(STATIC_PUBLIC.test(p), p).toBe(false);
  });
});
