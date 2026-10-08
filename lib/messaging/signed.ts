import { createHmac, timingSafeEqual } from "node:crypto";

// M6: small signed values for links and cookies (portal sessions, unsubscribe
// links). HMAC-SHA256 over a base64url JSON payload; nothing secret inside,
// only ids and an expiry, so a stolen value grants no more than it says.

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

export function sign(payload: object, secret: string): string {
  const body = b64(JSON.stringify(payload));
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify<T extends object>(value: string | undefined | null, secret: string): T | null {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", secret).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    if (typeof payload.exp === "number" && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}
