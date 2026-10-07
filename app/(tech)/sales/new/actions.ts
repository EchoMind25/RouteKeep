"use server";

import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { pgErrorCode } from "@/lib/db/rls";
import { failure, fieldErrors, formValues, type FormState } from "@/lib/forms";
import { createCustomer } from "@/lib/server/customers";
import { getSalesSettings, myTechnician } from "@/lib/server/sales";
import { newCustomerSchema, toNewCustomerInput } from "../../../(office)/customers/new/schema";

// FR-SAL-02: a customer added in the field, credited to the technician who
// added it. Who services it and when is left to the office.
export async function createTechSaleAction(_prev: FormState, data: FormData): Promise<FormState> {
  const member = await requireMember(["technician"]);
  const values = formValues(data);
  const [settings, me] = await Promise.all([getSalesSettings(member), myTechnician(member)]);
  if (!settings.enabled) return failure(values, "Your office has turned off adding customers from the field.");
  if (!me) return failure(values, "Your login is not linked to a technician profile yet. Ask the office.");
  const parsed = newCustomerSchema.safeParse({ ...values, technicianId: "", windowStart: "", windowEnd: "", soldBy: "" });
  if (!parsed.success) return failure(values, "Check the highlighted fields.", fieldErrors(parsed.error));
  try {
    await createCustomer(member, toNewCustomerInput(parsed.data, me.id));
  } catch (error) {
    if (pgErrorCode(error) === "42501") return failure(values, "Your office has turned off adding customers from the field.");
    if (error instanceof Error && error.message === "That plan is not available") return failure(values, error.message, { planId: error.message });
    throw error;
  }
  redirect("/sales?added=1");
}
