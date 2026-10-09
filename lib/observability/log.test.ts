import { afterEach, describe, expect, it, vi } from "vitest";
import { errorText, log } from "./log";

// NFR-06: one JSON line per event; outside a request there is no request id.
describe("log", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one JSON line with level, event and fields", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("thing failed", { tenantId: "t1", error: errorText(new Error("boom")) });
    await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
    const line = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(line).toMatchObject({ level: "error", event: "thing failed", requestId: null, tenantId: "t1", error: "boom" });
    expect(typeof line.ts).toBe("string");
  });
});
