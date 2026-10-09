import { describe, expect, it } from "vitest";
import { MAX_REPORT_BYTES, parseClientReport, readLimited, tooLarge } from "./client-report";

const ok = { kind: "boundary", fingerprint: "0123456789abcdef", message: "boom", route: "/schedule" };

describe("browser error report endpoint parsing (OPS-03)", () => {
  it("accepts a valid report", () => {
    expect(parseClientReport(JSON.stringify(ok))).toEqual(ok);
  });
  it("scrubs the message again on the server", () => {
    const r = parseClientReport(JSON.stringify({ ...ok, message: "no customer bob@example.com 555-123-4567" }));
    expect(r?.message).toBe("no customer <email> <phone>");
  });
  it("rejects bad JSON, unknown props and wrong types", () => {
    expect(parseClientReport("not json")).toBeNull();
    expect(parseClientReport(JSON.stringify({ ...ok, userId: "u1" }))).toBeNull();
    expect(parseClientReport(JSON.stringify({ ...ok, kind: "page_view" }))).toBeNull();
    expect(parseClientReport(JSON.stringify([ok]))).toBeNull();
  });
  it("rejects bodies over 4 KB", () => {
    expect(tooLarge(MAX_REPORT_BYTES + 1)).toBe(true);
    expect(tooLarge(Number("abc"))).toBe(true);
    expect(parseClientReport(JSON.stringify({ ...ok, pad: "x".repeat(MAX_REPORT_BYTES) }))).toBeNull();
  });
  it("stops reading a stream past the limit", async () => {
    const big = new Response("x".repeat(MAX_REPORT_BYTES + 10)).body;
    expect(await readLimited(big)).toBeNull();
    expect(await readLimited(new Response("hello").body)).toBe("hello");
  });
});
