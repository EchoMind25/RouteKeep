"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireMember } from "@/lib/auth/session";
import { parseMoneyToCents } from "@/lib/domain/money";
import { failure, fieldErrors, formValues, optionalTrimmed, trimmed, type FormState } from "@/lib/forms";
import { addCredit, BillingRefusedError, recordPayment, runBillingNow, voidInvoice } from "@/lib/server/billing";

// FR-BIL-01, FR-BIL-06: the office's billing actions. Owner, admin and office;
// dispatchers schedule, they do not take money.
const BILLING_ROLES = ["owner", "admin", "office"] as const;

const money = z
  .string()
  .trim()
  .transform((v, ctx) => {
    try {
      const cents = parseMoneyToCents(v);
      if (cents <= 0) throw new Error("Enter an amount above zero");
      return cents;
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message || "Enter an amount" });
      return z.NEVER;
    }
  });

export async function runBillingAction(): Promise<void> {
  const member = await requireMember(BILLING_ROLES);
  const result = await runBillingNow(member);
  revalidatePath("/billing", "layout");
  redirect(`/billing?ran=${result.invoicesCreated}.${result.paymentsPosted}.${result.failures.length}`);
}

const paymentSchema = z
  .object({
    invoiceId: z.uuid(),
    key: z.string().min(8).max(100),
    method: z.enum(["cash", "check", "other"], { error: "Choose how they paid" }),
    amount: money,
    checkNumber: optionalTrimmed(40),
    memo: optionalTrimmed(200),
  })
  .superRefine((v, ctx) => {
    if (v.method === "check" && !v.checkNumber) ctx.addIssue({ code: "custom", path: ["checkNumber"], message: "Enter the check number" });
  });

export async function recordPaymentAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(BILLING_ROLES);
  const values = formValues(data);
  const parsed = paymentSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  try {
    await recordPayment(member, { invoiceId: v.invoiceId, key: v.key, method: v.method, amountCents: v.amount, checkNumber: v.method === "check" ? v.checkNumber : null, memo: v.memo });
  } catch (error) {
    if (error instanceof BillingRefusedError) return failure(values, error.message, { amount: error.message });
    throw error;
  }
  revalidatePath("/billing", "layout");
  redirect(`/billing/invoices/${v.invoiceId}?done=paid`);
}

const creditSchema = z.object({ invoiceId: z.uuid(), key: z.string().min(8).max(100), amount: money, reason: trimmed("The reason", 200) });

export async function addCreditAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(BILLING_ROLES);
  const values = formValues(data);
  const parsed = creditSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  try {
    await addCredit(member, { invoiceId: parsed.data.invoiceId, key: parsed.data.key, amountCents: parsed.data.amount, reason: parsed.data.reason });
  } catch (error) {
    if (error instanceof BillingRefusedError) return failure(values, error.message, { amount: error.message });
    throw error;
  }
  revalidatePath("/billing", "layout");
  redirect(`/billing/invoices/${parsed.data.invoiceId}?done=credited`);
}

const voidSchema = z.object({ invoiceId: z.uuid(), reason: trimmed("The reason", 200) });

export async function voidInvoiceAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(BILLING_ROLES);
  const values = formValues(data);
  const parsed = voidSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Say why before voiding.", fieldErrors(parsed.error));
  try {
    await voidInvoice(member, parsed.data);
  } catch (error) {
    if (error instanceof BillingRefusedError) return failure(values, error.message);
    throw error;
  }
  revalidatePath("/billing", "layout");
  redirect(`/billing/invoices/${parsed.data.invoiceId}?done=voided`);
}
