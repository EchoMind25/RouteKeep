import { describe, expect, it } from "vitest";
import { fingerprint, firstAppFrame, MAX_MESSAGE, routePattern, scrubMessage } from "./scrub";

describe("scrubMessage (OPS-03)", () => {
  it("removes emails", () => {
    expect(scrubMessage("no user jane.doe+x@example.co.uk found")).toBe("no user <email> found");
  });
  it("removes phone numbers in common shapes", () => {
    for (const p of ["(801) 555-0199", "+1 801 555 0199", "801-555-0199", "801.555.0199"]) {
      expect(scrubMessage(`call ${p} now`)).toBe("call <phone> now");
    }
  });
  it("removes runs of four or more digits but keeps short numbers", () => {
    expect(scrubMessage("invoice 12345 failed after 3 tries")).toBe("invoice <n> failed after 3 tries");
  });
  it("removes uuids", () => {
    expect(scrubMessage("visit 3f2c9a1e-5b7d-4c1a-9e2f-0a1b2c3d4e5f not found")).toBe("visit <id> not found");
  });
  it("removes Postgres key details", () => {
    expect(scrubMessage('duplicate key value violates unique constraint "customers_email" Key (tenant_id, email)=(abc, bob@x.com) already exists.')).toBe(
      'duplicate key value violates unique constraint "?" Key (?)=(?) already exists.',
    );
  });
  it("removes quoted values without eating apostrophes", () => {
    expect(scrubMessage("Cannot read properties of undefined (reading 'Smith')")).toBe('Cannot read properties of undefined (reading "?")');
    expect(scrubMessage('Unexpected token "Jane Doe" in JSON')).toBe('Unexpected token "?" in JSON');
    expect(scrubMessage("can't find it")).toBe("can't find it");
  });
  it("drops query strings and fragments from URLs", () => {
    expect(scrubMessage("GET https://x.test/customers?q=smith&page=2#top failed")).toBe("GET https://x.test/customers failed");
    expect(scrubMessage("fetch /api/search?name=bob failed")).toBe("fetch /api/search failed");
  });
  it("removes long opaque tokens", () => {
    expect(scrubMessage("bad token eyJhbGciOiJIUzI1NiJ9abc123xyz")).toBe("bad token <id>");
  });
  it("collapses whitespace and caps at 200 characters", () => {
    expect(scrubMessage("  a \n\t b  ")).toBe("a b");
    expect(scrubMessage("x".repeat(500))).toHaveLength(MAX_MESSAGE);
  });
  it("accepts errors and non-strings", () => {
    expect(scrubMessage(new Error("boom 99999"))).toBe("boom <n>");
    expect(scrubMessage(undefined)).toBe("");
  });
});

describe("routePattern (OPS-03)", () => {
  it("replaces ids, uuids and digits with :id and drops query and hash", () => {
    expect(routePattern("/customers/3f2c9a1e-5b7d-4c1a-9e2f-0a1b2c3d4e5f/edit?tab=notes#x")).toBe("/customers/:id/edit");
    expect(routePattern("/invoices/1042")).toBe("/invoices/:id");
    expect(routePattern("/schedule")).toBe("/schedule");
    expect(routePattern("/")).toBe("/");
  });
  it("never keeps tokens or capitalised segments", () => {
    expect(routePattern("/u/AbCdEf_ghIJ-klmn")).toBe("/u/:id");
    expect(routePattern("/p/3f2c9a1e-5b7d-4c1a-9e2f-0a1b2c3d4e5f/telemetry")).toBe("/p/:id/telemetry");
  });
  it("strips an origin", () => {
    expect(routePattern("https://app.example.com/sign-in?next=/x")).toBe("/sign-in");
  });
});

describe("fingerprint (OPS-03)", () => {
  const stack = "TypeError: x\n    at render (https://a.test/_next/static/chunks/app/page-abc.js:12:345)\n    at node_modules/react/x.js:1:1";
  it("is 16 hex characters and stable", () => {
    const a = fingerprint("error", "boom", stack);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint("error", "boom", stack)).toBe(a);
  });
  it("ignores line and column numbers, hosts and ids in the message", () => {
    const moved = stack.replace(":12:345", ":99:1").replace("https://a.test", "https://b.test");
    expect(fingerprint("error", "visit 11111111-2222-4333-8444-555555555555 failed", stack)).toBe(fingerprint("error", "visit 99999999-2222-4333-8444-555555555555 failed", moved));
  });
  it("differs by kind and message", () => {
    expect(fingerprint("error", "boom", stack)).not.toBe(fingerprint("boundary", "boom", stack));
    expect(fingerprint("error", "boom", stack)).not.toBe(fingerprint("error", "bang", stack));
  });
  it("picks the first app frame", () => {
    expect(firstAppFrame(stack)).toBe("at render (/_next/static/chunks/app/page-abc.js)");
  });
});
