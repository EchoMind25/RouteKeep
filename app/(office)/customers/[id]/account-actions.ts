"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import { kickOutbox } from "@/lib/messaging/kick";
import { requestSignInLink } from "@/lib/portal/data";
import { markRequestDone } from "@/lib/server/messages";

// FR-POR-01: the office can email a customer their sign-in link.
export async function sendPortalLinkAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const member = await requireMember(OFFICE_ROLES);
  const id = z.uuid().safeParse((input as { customerId?: unknown })?.customerId);
  if (!id.success) return { ok: false, message: "Reload the page and try again." };
  const email = await withRls(member.claims, async (tx) => (await tx.selectFrom("customers").select("email").where("id", "=", id.data).executeTakeFirst())?.email ?? null);
  if (!email) return { ok: false, message: "Add an email address first." };
  await requestSignInLink(member.tenantId, email);
  kickOutbox(member.tenantId);
  revalidatePath(`/customers/${id.data}`);
  return { ok: true, message: `Sign-in link sent to ${email}. It works once, for 20 minutes.` };
}

export async function requestDoneAction(data: FormData) {
  const member = await requireMember(OFFICE_ROLES);
  const id = z.uuid().parse(data.get("id"));
  await markRequestDone(member, id);
  revalidatePath("/customers", "layout");
}
