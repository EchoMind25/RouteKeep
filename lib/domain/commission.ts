// FR-SAL-01: a sale earns a flat amount plus a percent of the plan's first
// service price. Integer cents throughout (ENG-06); the percent is applied in
// hundredths so 7.5% of $199.00 is exact. The database computes the amount it
// stores (app.record_sale_commission) with the same rule; this is for showing
// it before the sale is saved.

export interface CommissionRule {
  flatCents: number;
  /** Percent, 0 to 100, up to two decimals. */
  pct: number;
}

export function commissionFor(rule: CommissionRule, basisCents: number): number {
  const hundredths = Math.round(rule.pct * 100);
  return rule.flatCents + Math.round((basisCents * hundredths) / 10_000);
}

/** The basis a plan earns on: its first service price, else its regular price. */
export function commissionBasis(plan: { priceCents: number; initialPriceCents: number | null } | null | undefined): number {
  if (!plan) return 0;
  return plan.initialPriceCents ?? plan.priceCents;
}

export const COMMISSION_STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "success" | "danger" }> = {
  pending: { label: "Waiting for approval", tone: "neutral" },
  approved: { label: "Approved", tone: "accent" },
  paid: { label: "Paid", tone: "success" },
  void: { label: "Void", tone: "danger" },
};
