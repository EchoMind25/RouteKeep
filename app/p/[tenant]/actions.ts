"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fieldErrors, type FormState } from "@/lib/forms";
import { kickOutbox } from "@/lib/messaging/kick";
import { requestService, requestSignInLink, withinRateLimit } from "@/lib/portal/data";
import { payInvoice, PortalPaymentError, setUpAutopay, turnOffAutopay } from "@/lib/portal/payments";
import { endPortalSession, portalSession } from "@/lib/portal/session";
import { errorText, log } from "@/lib/observability/log";

const tenantId = z.uuid();

/** First hop only. Netlify's own header wins; the value must look like an address. */
function clientIp(h: Pick<Headers, "get">): string {
  const raw = h.get("x-nf-client-connection-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "";
  const ip = raw.trim().slice(0, 64);
  return /^[0-9a-fA-F:.]+$/.test(ip) ? ip : "unknown";
}

// FR-POR-01: the same answer whether or not the address is on file, and the
// same answer when a limit is hit (10 per 10 minutes per IP and business, 100
// an hour per business): no email is sent and there is nothing to learn.
export async function requestLinkAction(_prev: FormState, data: FormData): Promise<FormState> {
  const tenant = tenantId.safeParse(data.get("tenant"));
  const email = z.email().safeParse(String(data.get("email") ?? "").trim().toLowerCase());
  if (!tenant.success) return { ok: false, message: "This page address is not right. Use the link from your email." };
  if (!email.success) return { ok: false, message: "Enter the email address you gave us.", errors: { email: "Enter an email address like name@example.com" }, values: { email: String(data.get("email") ?? "") } };
  const ip = clientIp(await headers());
  const allowed = (await withinRateLimit(`portal-link:ip:${tenant.data}:${ip}`, 600, 10)) && (await withinRateLimit(`portal-link:tenant:${tenant.data}`, 3600, 100));
  if (allowed && (await requestSignInLink(tenant.data, email.data))) kickOutbox(tenant.data);
  return { ok: true, message: `If ${email.data} is on file, a sign-in link is on its way. It works once, for 20 minutes.` };
}

export async function signOutAction(data: FormData) {
  const tenant = tenantId.parse(data.get("tenant"));
  await endPortalSession(tenant);
  redirect(`/p/${tenant}`);
}

// FR-POR-02: "request service" reaches the office's list.
export async function requestServiceAction(_prev: FormState, data: FormData): Promise<FormState> {
  const tenant = tenantId.parse(data.get("tenant"));
  const claims = await portalSession(tenant);
  if (!claims) redirect(`/p/${tenant}`);
  const v = z
    .object({
      key: z.string().min(8).max(80),
      message: z.string().trim().min(3, "Tell us what you need").max(2000),
      preferred: z.string().trim().max(200).optional(),
      propertyId: z.uuid().optional().or(z.literal("")),
    })
    .safeParse(Object.fromEntries(data.entries()));
  if (!v.success) return { ok: false, message: v.error.issues[0]?.message ?? "Check the form.", errors: fieldErrors(v.error), values: { message: String(data.get("message") ?? "") } };
  await requestService(claims, { key: v.data.key, message: v.data.message, preferred: v.data.preferred || null, propertyId: v.data.propertyId || null });
  return { ok: true, message: "Sent. The office will call or email you to set a time." };
}

// FR-POR-02, FR-BIL-02, CR-06: pay an invoice, set up or turn off autopay.
// Each sends the customer to Stripe's own page, or back here with a short
// code that the page turns into words (never text taken from the address).

async function signedIn(data: FormData) {
  const tenant = tenantId.parse(data.get("tenant"));
  const claims = await portalSession(tenant);
  if (!claims) redirect(`/p/${tenant}`);
  return { tenant, claims };
}

const key = z.string().min(8).max(80);

async function toStripe(tenant: string, open: () => Promise<string>): Promise<never> {
  let url: string;
  try {
    url = await open();
  } catch (error) {
    if (!(error instanceof PortalPaymentError)) log.error("portal payment failed", { error: errorText(error) });
    redirect(`/p/${tenant}?pay=${error instanceof PortalPaymentError ? error.code : "stripe"}`);
  }
  redirect(url);
}

export async function payInvoiceAction(data: FormData) {
  const { tenant, claims } = await signedIn(data);
  const invoiceId = z.uuid().parse(data.get("invoiceId"));
  await toStripe(tenant, () => payInvoice(claims, invoiceId, key.parse(data.get("key"))));
}

export async function setUpAutopayAction(data: FormData) {
  const { tenant, claims } = await signedIn(data);
  await toStripe(tenant, () => setUpAutopay(claims, key.parse(data.get("key"))));
}

export async function turnOffAutopayAction(data: FormData) {
  const { tenant, claims } = await signedIn(data);
  await turnOffAutopay(claims);
  redirect(`/p/${tenant}?autopay=off`);
}
