// M4 stage 2: the rules for online payments that do not need Stripe or the
// database to check, so they are unit tested on their own.

/** FR-BIL-04: autopay tries an invoice three times: when it is issued, 3 days later, then 4 days after that. */
export const AUTOPAY_RETRY_DAYS = [3, 4] as const;
export const AUTOPAY_MAX_ATTEMPTS = AUTOPAY_RETRY_DAYS.length + 1;

/** When to try again after `attempts` failed tries, or null when autopay gives up and the invoice waits in collections. */
export function nextAutopayAttempt(attempts: number, failedAt: Date): Date | null {
  const days = AUTOPAY_RETRY_DAYS[attempts - 1];
  return days === undefined ? null : new Date(failedAt.getTime() + days * 86_400_000);
}

/**
 * Declines that retrying the same card will not fix. The invoice still waits
 * in collections and the customer is asked to update their card; the retry
 * schedule keeps going in case they do.
 */
const HARD_DECLINES = new Set(["expired_card", "incorrect_number", "invalid_account", "account_closed", "no_account", "stolen_card", "lost_card", "pickup_card", "debit_not_authorized", "authentication_required"]);

export function needsNewMethod(code: string | null | undefined): boolean {
  return code ? HARD_DECLINES.has(code) : false;
}

/** Plain words for a decline, for the office and the customer. Never Stripe's raw message. */
export function declineText(code: string | null | undefined): string {
  switch (code) {
    case "insufficient_funds":
      return "Not enough funds";
    case "expired_card":
      return "The card has expired";
    case "authentication_required":
      return "The bank wants the customer to approve this payment themselves";
    case "account_closed":
    case "no_account":
    case "invalid_account":
      return "The bank account is closed or not valid";
    case "debit_not_authorized":
      return "The customer's bank says the payment was not authorized";
    case "lost_card":
    case "stolen_card":
    case "pickup_card":
      return "The card can no longer be used";
    default:
      return "The payment was declined";
  }
}

export type PaymentStatus = "pending" | "processing" | "succeeded" | "failed" | "canceled";

/**
 * Where a payment may go from where it is. A succeeded payment never goes back:
 * money returned later is a refund (FR-BIL-06), a disputed one is listed for
 * the owner. Events can arrive out of order; this keeps the newest truth.
 */
export function canMove(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return false;
  if (from === "succeeded" || from === "canceled") return false;
  if (from === "failed") return to === "succeeded";
  if (from === "processing") return to === "succeeded" || to === "failed";
  return true;
}

/** "Visa ending 4242", "Chase ending 6789". */
export function methodLabel(input: { kind: "card" | "us_bank_account"; brand?: string | null; bankName?: string | null; last4?: string | null }): string {
  const name = input.kind === "card" ? brandName(input.brand) : (input.bankName?.trim() || "Bank account");
  return (input.last4 ? `${name} ending ${input.last4}` : name).slice(0, 80);
}

function brandName(brand: string | null | undefined): string {
  const names: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay" };
  return (brand && names[brand]) || "Card";
}

/** CR-06: what the customer agrees to when they turn autopay on. Stored with the method, word for word. */
export function autopayConsent(businessName: string): string {
  return `I allow ${businessName} to charge this payment method for each invoice when it is issued, and to try again up to two more times if a payment fails. I can turn autopay off at any time from my account page or by contacting ${businessName}.`;
}

/** ENG-02: Stripe idempotency keys derived from our row ids. */
export const idempotency = {
  customer: (customerId: string) => `rk-customer-${customerId}`,
  checkout: (paymentId: string) => `rk-checkout-${paymentId}`,
  setup: (customerId: string, key: string) => `rk-setup-${customerId}-${key}`,
  charge: (paymentId: string) => `rk-charge-${paymentId}`,
  refund: (paymentId: string, key: string) => `rk-refund-${paymentId}-${key}`,
  account: (tenantId: string) => `rk-account-${tenantId}`,
};
