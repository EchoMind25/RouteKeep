import type { AmountUnit } from "@/lib/domain/units";

// FR-INV-07: turns what the technician typed into count lines. Numbers stay text
// until here; blank is only allowed with the explicit "not on truck" choice (= 0).

export interface CheckEntry {
  value: string;
  notOnTruck: boolean;
}

export const MAX_COUNT = 10_000_000;

/** A non-negative amount from text, or null. Accepts a decimal comma. */
export function parseCount(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= MAX_COUNT ? n : null;
}

export function buildCountLines(
  products: readonly { productId: string; unit: AmountUnit }[],
  entries: Readonly<Record<string, CheckEntry | undefined>>,
): { lines: { productId: string; qty: number; unit: AmountUnit }[]; errors: Record<string, string> } {
  const lines: { productId: string; qty: number; unit: AmountUnit }[] = [];
  const errors: Record<string, string> = {};
  for (const p of products) {
    const e = entries[p.productId];
    if (e?.notOnTruck) {
      lines.push({ productId: p.productId, qty: 0, unit: p.unit });
      continue;
    }
    if (!e || e.value.trim() === "") {
      errors[p.productId] = "Enter an amount, or mark it not on truck.";
      continue;
    }
    const qty = parseCount(e.value);
    if (qty === null) errors[p.productId] = "Enter a number, zero or more.";
    else lines.push({ productId: p.productId, qty, unit: p.unit });
  }
  return { lines, errors };
}
