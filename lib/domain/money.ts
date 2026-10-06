// Money is integer cents everywhere (ENG-06). Dollars exist only as text a
// person typed or will read.

export class MoneyError extends Error {
  override name = "MoneyError";
}

const MONEY_RE = /^\$?\s*(\d{1,3}(,\d{3})*|\d+)(\.(\d{1,2}))?$/;
const MAX_CENTS = 2_000_000_000; // stays inside a Postgres integer

/** "129", "129.9", "$1,299.00" -> cents. Never goes through a float. */
export function parseMoneyToCents(input: string): number {
  const text = input.trim();
  const m = MONEY_RE.exec(text);
  if (!m) throw new MoneyError("Enter an amount like 129 or 129.00");
  const dollars = Number(m[1]!.replaceAll(",", ""));
  const cents = Number((m[4] ?? "").padEnd(2, "0"));
  const total = dollars * 100 + cents;
  if (!Number.isSafeInteger(total) || total > MAX_CENTS) throw new MoneyError("That amount is too large");
  return total;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new MoneyError("Cents must be a whole number");
  return usd.format(cents / 100);
}

/** For form fields: 12900 -> "129.00". */
export function centsToInput(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
