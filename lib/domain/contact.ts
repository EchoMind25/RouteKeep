// Phone numbers, emails and US addresses as the forms accept them.

export class ContactError extends Error {
  override name = "ContactError";
}

/** US/Canada numbers to E.164. Accepts "(801) 555-0142", "801.555.0142", "+1 801 555 0142". */
export function normalizeUsPhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  const plain = digits.startsWith("+") ? digits.slice(1) : digits;
  if (!/^\d+$/.test(plain)) throw new ContactError("Use digits only, like 801-555-0142");
  const national = plain.length === 11 && plain.startsWith("1") ? plain.slice(1) : plain;
  if (national.length !== 10) throw new ContactError("Enter a 10-digit US phone number");
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) throw new ContactError("That is not a valid US phone number");
  return `+1${national}`;
}

/** +18015550142 -> (801) 555-0142 */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ContactError("Enter an email like name@example.com");
  return email;
}

export const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"],
  ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"],
  ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"],
  ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"],
  ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
] as const;

export type UsStateCode = (typeof US_STATES)[number][0];

export function isUsState(code: string): code is UsStateCode {
  return US_STATES.some(([c]) => c === code);
}

export interface Address {
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postalCode: string;
}

export function formatAddress(a: Address): string {
  const street = [a.line1, a.line2].filter((p) => p && p.trim()).join(", ");
  return `${street}, ${a.city}, ${a.region} ${a.postalCode}`;
}

/** Zones a US tenant may pick, Mountain West first (first market). */
export const US_TIMEZONES = [
  ["America/Denver", "Mountain (Denver, Salt Lake City)"],
  ["America/Boise", "Mountain (Boise)"],
  ["America/Phoenix", "Arizona (no daylight saving)"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Chicago", "Central"],
  ["America/New_York", "Eastern"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
] as const;
