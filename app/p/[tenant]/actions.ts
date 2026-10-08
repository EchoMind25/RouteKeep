"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/lib/forms";
import { kickOutbox } from "@/lib/messaging/kick";
import { requestService, requestSignInLink } from "@/lib/portal/data";
import { payInvoice, PortalPaymentError, setUpAutopay, turnOffAutopay } from "@/lib/portal/payments";
import { endPortalSession, portalSession } from "@/lib/portal/session";

const tenantId = z.uuid();

// FR-POR-01: the same answer whether or not the address is on file.
export async function requestLinkAction(_prev: FormState, data: FormData): Promise<FormState> {
  const tenant = tenantId.safeParse(data.get("tenant"));
  const email = z.email().safeParse(String(data.get("email") ?? "").trim().toLowerCase());
  if (!tenant.success) return { ok: false, message: "This page address is not right. Use the link from your email." };
  if (!email.success) return { ok: false, message: "Enter the email address you gave us.", values: { email: String(data.get("email") ?? "") } };
  await requestSignInLink(tenant.data, email.data);
  kickOutbox(tenant.data);
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
  if (!v.success) return { ok: false, message: v.error.issues[0]?.message ?? "Check the form.", values: { message: String(data.get("message") ?? "") } };
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
    if (!(error instanceof PortalPaymentError)) console.error(JSON.stringify({ msg: "portal payment failed", error: error instanceof Error ? error.message : String(error) }));
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
