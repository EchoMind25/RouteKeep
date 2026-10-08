import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { emailProvider, env } from "@/lib/env";

// D-10: how email leaves. "log" writes each message to a file on this machine
// (development and tests; lib/env.ts refuses it anywhere else). "resend" sends
// through Resend's API with an idempotency key, so a retried send goes once.

export interface OutgoingEmail {
  idempotencyKey: string;
  to: string;
  replyTo: string | null;
  fromName: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  readonly name: "log" | "resend";
  send(email: OutgoingEmail): Promise<{ providerId: string | null }>;
}

export class PermanentEmailError extends Error {}

function logProvider(dir: string): EmailProvider {
  return {
    name: "log",
    async send(email) {
      const root = resolve(dir);
      await mkdir(root, { recursive: true });
      await writeFile(join(root, `${Date.now()}-${email.idempotencyKey}.json`), JSON.stringify(email, null, 2));
      return { providerId: null };
    },
  };
}

function resendProvider(apiKey: string, from: string): EmailProvider {
  return {
    name: "resend",
    async send(email) {
      // The address is ours; the display name is the business's (FR-BRD-03).
      const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": email.idempotencyKey },
        body: JSON.stringify({
          from: `${email.fromName.replace(/["<>]/g, "")} <${address}>`,
          to: [email.to],
          reply_to: email.replyTo ?? undefined,
          subject: email.subject,
          text: email.text,
          html: email.html,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 422 || res.status === 400) throw new PermanentEmailError(`Resend refused the message (${res.status}): ${(await res.text()).slice(0, 200)}`);
      if (!res.ok) throw new Error(`Resend error ${res.status}`);
      const body = (await res.json()) as { id?: string };
      return { providerId: body.id ?? null };
    },
  };
}

export function emailSender(): EmailProvider | null {
  const which = emailProvider();
  const e = env();
  if (which === "log") return logProvider(e.LOCAL_MAIL_DIR);
  if (which === "resend") return resendProvider(e.RESEND_API_KEY!, e.EMAIL_FROM!);
  return null;
}
