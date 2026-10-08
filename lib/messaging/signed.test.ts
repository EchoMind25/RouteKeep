import { describe, expect, it } from "vitest";
import { sign, verify } from "./signed";

const SECRET = "x".repeat(40);

describe("signed values (M6)", () => {
  it("round-trips and refuses tampering, other secrets and expiry", () => {
    const v = sign({ t: "tenant", c: "customer", exp: Date.now() / 1000 + 60 }, SECRET);
    expect(verify<{ c: string }>(v, SECRET)?.c).toBe("customer");
    const [body, mac] = v.split(".");
    const forged = `${Buffer.from(JSON.stringify({ t: "tenant", c: "someone-else" })).toString("base64url")}.${mac}`;
    expect(verify(forged, SECRET)).toBeNull();
    expect(verify(v, "y".repeat(40))).toBeNull();
    expect(verify(`${body}`, SECRET)).toBeNull();
    expect(verify(sign({ exp: Date.now() / 1000 - 1 }, SECRET), SECRET)).toBeNull();
  });
});
