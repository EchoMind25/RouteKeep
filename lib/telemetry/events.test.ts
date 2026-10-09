import { describe, expect, it } from "vitest";
import { engineOf, EVENTS, isEventName, parseEvent } from "./events";

describe("event catalog (OPS-03)", () => {
  it("has exactly the contract's v1 events", () => {
    expect(Object.keys(EVENTS).sort()).toEqual([
      "error.client", "error.server", "route.manual_change_after_optimize", "route.proposal_accepted",
      "route.proposal_dismissed", "route.proposal_shown", "route.proposal_undone", "route.stop_out_of_order",
    ]);
  });
  it("rejects unknown names", () => {
    expect(isEventName("page.view")).toBe(false);
    expect(parseEvent("page.view", {})).toBeNull();
  });
  it("rejects unknown props", () => {
    expect(parseEvent("route.proposal_undone", { engine: "ai" })).toEqual({ engine: "ai" });
    expect(parseEvent("route.proposal_undone", { engine: "ai", user_id: "u1" })).toBeNull();
    expect(parseEvent("route.proposal_accepted", { engine: "solver", stops: 3, customer: "Bob" })).toBeNull();
  });
  it("bounds numbers and enums", () => {
    expect(parseEvent("route.proposal_shown", { engine: "solver", stops: 5, saved_minutes: 12 })).not.toBeNull();
    expect(parseEvent("route.proposal_shown", { engine: "google", stops: 5, saved_minutes: 12 })).toBeNull();
    expect(parseEvent("route.proposal_shown", { engine: "solver", stops: 1.5, saved_minutes: 12 })).toBeNull();
    expect(parseEvent("route.proposal_shown", { engine: "solver", stops: 5, saved_minutes: 99999 })).toBeNull();
    expect(parseEvent("route.stop_out_of_order", { published_position: 0, actual_position: 2, stops: 5 })).toBeNull();
  });
  it("only accepts route patterns and hex fingerprints in error reports", () => {
    const ok = { kind: "error", fingerprint: "0123456789abcdef", message: "boom", route: "/customers/:id" };
    expect(parseEvent("error.client", ok)).toEqual(ok);
    expect(parseEvent("error.client", { ...ok, route: "/customers/1234" })).toBeNull();
    expect(parseEvent("error.client", { ...ok, fingerprint: "xyz" })).toBeNull();
    expect(parseEvent("error.client", { ...ok, message: "x".repeat(201) })).toBeNull();
    expect(parseEvent("error.server", { ...ok, kind: "app_render", digest: "12345" })).not.toBeNull();
  });
  it("maps providers to engines", () => {
    expect(engineOf("ai")).toBe("ai");
    expect(engineOf("estimate")).toBe("solver");
    expect(engineOf(null)).toBe("solver");
  });
});
