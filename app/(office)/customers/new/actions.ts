"use server";

import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { pgErrorCode } from "@/lib/db/rls";
import { failure, fieldErrors, formValues, type FormState } from "@/lib/forms";
import { createCustomer } from "@/lib/server/customers";
import { newCustomerSchema, toNewCustomerInput } from "./schema";

export async function createCustomerAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(["owner", "admin", "office", "dispatcher"]);
  const values = formValues(data);
  const parsed = newCustomerSchema.safeParse(values);
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  if (v.planId && member.role === "dispatcher") {
    return failure(values, "Dispatchers cannot sell plans. Save the customer without a plan, or ask the office.");
  }

  let customerId: string;
  try {
    const result = await createCustomer(member, toNewCustomerInput(v, v.soldBy || null));
    customerId = result.customerId;
  } catch (error) {
    if (pgErrorCode(error) === "42501") return failure(values, "Your role cannot do that.");
    if (error instanceof Error && error.message === "That plan is not available") return failure(values, error.message, { planId: error.message });
    throw error;
  }
  redirect(`/customers/${customerId}?created=1`);
}
