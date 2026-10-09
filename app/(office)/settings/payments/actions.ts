"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireMember } from "@/lib/auth/session";
import { BillingRefusedError } from "@/lib/server/billing";
import { refreshStripeStatus, resolveIssue, startStripeOnboarding } from "@/lib/server/payments";
import { errorText, log } from "@/lib/observability/log";

// D-09, FR-BIL-07: connecting Stripe and clearing reconciliation findings.

export async function connectStripeAction(): Promise<void> {
  const member = await requireMember(["owner"]);
  let url: string;
  try {
    url = await startStripeOnboarding(member);
  } catch (error) {
    const message = error instanceof BillingRefusedError ? error.message : "Stripe didn't answer. Try again in a minute.";
    if (!(error instanceof BillingRefusedError)) log.error("stripe onboarding failed", { error: errorText(error) });
    redirect(`/settings/payments?error=${encodeURIComponent(message)}`);
  }
  redirect(url);
}

export async function refreshStripeAction(): Promise<void> {
  const member = await requireMember(["owner", "admin"]);
  try {
    await refreshStripeStatus(member);
  } catch (error) {
    log.error("stripe refresh failed", { error: errorText(error) });
    redirect(`/settings/payments?error=${encodeURIComponent("Stripe didn't answer. Try again in a minute.")}`);
  }
  revalidatePath("/settings/payments");
  redirect("/settings/payments");
}

export async function resolveIssueAction(data: FormData): Promise<void> {
  const member = await requireMember(["owner", "admin"]);
  await resolveIssue(member, z.uuid().parse(data.get("id")));
  revalidatePath("/settings/payments");
}
