import { z } from "zod";

/**
 * What a server action hands back to its form. On failure the submitted
 * values come back too: React resets a form after its action runs, and the
 * fields reset to these defaults instead of going blank.
 */
export interface FormState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
  values?: Record<string, string>;
}

export const initialFormState: FormState = { ok: false };

export function formValues(data: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of data.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) out[key] = value;
  }
  return out;
}

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

export function failure(values: Record<string, string>, message: string, errors?: Record<string, string>): FormState {
  return { ok: false, message, errors, values };
}

// Reusable field schemas -----------------------------------------------------------

export const trimmed = (label: string, max = 200) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} is too long`);

export const optionalTrimmed = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, "Too long")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");
