"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/lib/forms";
import { kickOutbox } from "@/lib/messaging/kick";
import { requestService, requestSignInLink } from "@/lib/portal/data";
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
