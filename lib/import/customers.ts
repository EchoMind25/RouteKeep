import { ContactError, isUsState, normalizeEmail, normalizeUsPhone, US_STATES } from "@/lib/domain/contact";
import { MoneyError, parseMoneyToCents } from "@/lib/domain/money";

// FR-MIG-04, FR-MIG-09, FR-MIG-10: one row of a customer list, whatever the
// software it came from: the customer, their service address, and optionally
// their plan and open balance. Columns are matched by header names and by
// what the values look like (rule-based, PRD 9.3); the owner can change any
// match before anything is checked.

export const FIELDS = [
  { key: "external_ref", label: "Customer number or ID", hint: "Used to recognise the same customer on a later import" },
  { key: "full_name", label: "Full name", hint: "Use this or first and last name" },
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "company_name", label: "Company name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "alt_phone", label: "Second phone" },
  { key: "address_line1", label: "Service street address", required: true },
  { key: "address_line2", label: "Apartment or unit" },
  { key: "city", label: "City", required: true },
  { key: "region", label: "State", required: true },
  { key: "postal_code", label: "ZIP code", required: true },
  { key: "access_notes", label: "Access notes", hint: "Gate codes, pets, where to park" },
  { key: "notes", label: "Customer notes" },
  { key: "plan_name", label: "Service plan", hint: "Must match a plan in Settings by name" },
  { key: "plan_price", label: "Price per service", hint: "When this customer pays something other than the plan's price" },
  { key: "next_service", label: "Next service date" },
  { key: "balance", label: "Open balance", hint: "What they owe today" },
  { key: "status", label: "Active or inactive" },
] as const;

export type FieldKey = (typeof FIELDS)[number]["key"];
export type ColumnMap = Partial<Record<FieldKey, string>>;

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

// Header names seen in exports from common field service software and in
// hand-made spreadsheets, normalised (lowercase, letters and digits only).
const SYNONYMS: Record<FieldKey, string[]> = {
  external_ref: ["customerid", "cust", "acct", "acctno", "accountid", "customerno", "customernumber", "custid", "accountnumber", "accountno", "account", "id", "clientid", "customer", "routekeepid", "externalref"],
  full_name: ["name", "fullname", "customername", "clientname", "displayname", "billingname"],
  first_name: ["firstname", "first", "fname", "givenname"],
  last_name: ["lastname", "last", "lname", "surname", "familyname"],
  company_name: ["company", "companyname", "business", "businessname", "organization"],
  email: ["email", "emailaddress", "email1", "primaryemail", "customeremail"],
  phone: ["phone", "phonenumber", "phone1", "primaryphone", "mobile", "cell", "cellphone", "mobilephone", "homephone"],
  alt_phone: ["phone2", "altphone", "alternatephone", "secondaryphone", "workphone", "otherphone"],
  address_line1: ["address", "address1", "addressline1", "street", "streetaddress", "serviceaddress", "serviceaddress1", "servicestreet", "addressline1", "propertyaddress"],
  address_line2: ["address2", "addressline2", "unit", "apt", "suite", "serviceaddress2"],
  city: ["city", "servicecity", "town"],
  region: ["state", "st", "servicestate", "province", "region"],
  postal_code: ["zip", "zipcode", "postalcode", "postcode", "servicezip"],
  access_notes: ["accessnotes", "gatecode", "directions", "propertynotes", "servicenotes", "accessinstructions", "techniciannotes"],
  notes: ["notes", "customernotes", "comments", "memo"],
  plan_name: ["plan", "planname", "serviceplan", "program", "servicetype", "service", "subscription"],
  plan_price: ["price", "serviceprice", "rate", "amount", "pricepervisit", "contractvalue"],
  next_service: ["nextservice", "nextservicedate", "nextdate", "nextvisit", "nextappointment", "startdate"],
  balance: ["balance", "openbalance", "balancedue", "amountdue", "ar", "pastdue", "currentbalance"],
  status: ["status", "active", "customerstatus", "accountstatus"],
};

/** Match headers to fields: exact synonyms first, then by what the values look like. */
export function autoMap(headers: readonly string[], sample: readonly (readonly string[])[]): ColumnMap {
  const map: ColumnMap = {};
  const taken = new Set<string>();
  for (const field of FIELDS) {
    const hit = headers.find((h) => !taken.has(h) && SYNONYMS[field.key].includes(norm(h)));
    if (hit) {
      map[field.key] = hit;
      taken.add(hit);
    }
  }
  // Unnamed or oddly named columns: look at the values.
  const looksLike = (k: number, test: (v: string) => boolean) => {
    const values = sample.map((r) => r[k] ?? "").filter(Boolean);
    return values.length > 0 && values.filter(test).length / values.length >= 0.8;
  };
  headers.forEach((h, k) => {
    if (taken.has(h)) return;
    if (!map.email && looksLike(k, (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))) {
      map.email = h;
      taken.add(h);
    } else if (!map.postal_code && looksLike(k, (v) => /^\d{5}(-\d{4})?$/.test(v))) {
      map.postal_code = h;
      taken.add(h);
    } else if (!map.phone && looksLike(k, (v) => v.replace(/\D/g, "").length >= 10 && /^[\d\s().+-]+$/.test(v))) {
      map.phone = h;
      taken.add(h);
    }
  });
  return map;
}

/** Headers that identify a known export, for presets (FR-MIG-01): sorted, normalised. */
export function headerSignature(headers: readonly string[]): string[] {
  return [...new Set(headers.map(norm))].sort();
}

export interface PlanRef {
  id: string;
  name: string;
  priceCents: number;
}

export interface NormalizedRow {
  externalRef: string;
  kind: "residential" | "commercial";
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  altPhone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  accessNotes: string | null;
  notes: string | null;
  planId: string | null;
  priceCents: number | null;
  nextService: string | null;
  balanceCents: number;
  active: boolean;
}

export type RowCheck = { ok: true; row: NormalizedRow; warnings: string[] } | { ok: false; reasons: string[] };

const STATE_BY_NAME = new Map<string, string>(US_STATES.map(([code, name]) => [name.toLowerCase(), code]));

function state(value: string): string | null {
  const v = value.trim();
  if (isUsState(v.toUpperCase())) return v.toUpperCase();
  return STATE_BY_NAME.get(v.toLowerCase()) ?? null;
}

/** 2026-10-07, 10/7/2026, 10/7/26 -> 2026-10-07; anything else is null. */
export function importDate(value: string): string | null {
  const v = value.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(v);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [m, d, y] = [Number(us[1]), Number(us[2]), us[3]!.length === 2 ? 2000 + Number(us[3]) : Number(us[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * A stable key for a row without an ID column, so importing the same file
 * twice changes nothing (FR-MIG-12): the name and service address, normalised.
 */
export function rowKey(name: string, line1: string, postalCode: string): string {
  return `row:${norm(name)}|${norm(line1)}|${postalCode.slice(0, 5)}`;
}

export function checkRow(raw: Record<string, string>, map: ColumnMap, plans: readonly PlanRef[]): RowCheck {
  const get = (k: FieldKey) => {
    const h = map[k];
    const v = h ? (raw[h] ?? "").trim() : "";
    return v === "" ? null : v;
  };
  const reasons: string[] = [];
  const warnings: string[] = [];

  let first = get("first_name");
  let last = get("last_name");
  const company = get("company_name");
  const full = get("full_name");
  if (!first && !last && full && !company) {
    // "Quintero, Marisol" or "Marisol Quintero"
    const comma = /^([^,]+),\s*(.+)$/.exec(full);
    if (comma) [last, first] = [comma[1]!.trim(), comma[2]!.trim()];
    else {
      const parts = full.split(/\s+/);
      first = parts.length > 1 ? parts.slice(0, -1).join(" ") : full;
      last = parts.length > 1 ? parts.at(-1)! : null;
    }
  }
  const displayName = company && !first && !last ? company : [first, last].filter(Boolean).join(" ") || full || company || "";
  if (!displayName) reasons.push("No name");

  const contact = (k: "email" | "phone" | "alt_phone", fn: (v: string) => string): string | null => {
    const v = get(k);
    if (!v) return null;
    try {
      return fn(v);
    } catch (e) {
      if (e instanceof ContactError) {
        // A bad second phone or email should not hold back the customer.
        warnings.push(`${k === "email" ? "Email" : k === "phone" ? "Phone" : "Second phone"} "${v}" left out: ${e.message.toLowerCase()}`);
        return null;
      }
      throw e;
    }
  };
  const email = contact("email", normalizeEmail);
  const phone = contact("phone", normalizeUsPhone);
  const altPhone = contact("alt_phone", normalizeUsPhone);

  const line1 = get("address_line1");
  const city = get("city");
  const regionRaw = get("region");
  const zipRaw = get("postal_code");
  if (!line1) reasons.push("No street address");
  if (!city) reasons.push("No city");
  const region = regionRaw ? state(regionRaw) : null;
  if (!regionRaw) reasons.push("No state");
  else if (!region) reasons.push(`State "${regionRaw}" is not a US state`);
  // Spreadsheets drop leading zeros from ZIP codes: 4057 was 04057.
  const zip = zipRaw ? (/^\d{3,4}$/.test(zipRaw) ? zipRaw.padStart(5, "0") : zipRaw) : null;
  if (!zipRaw) reasons.push("No ZIP code");
  else if (!/^\d{5}(-\d{4})?$/.test(zip!)) reasons.push(`ZIP code "${zipRaw}" is not 5 digits`);

  const planName = get("plan_name");
  let planId: string | null = null;
  if (planName) {
    const plan = plans.find((p) => p.name.trim().toLowerCase() === planName.toLowerCase());
    if (plan) planId = plan.id;
    else reasons.push(`Plan "${planName}" is not in Settings. Add it, or clear the plan column`);
  }
  const money = (k: "plan_price" | "balance", label: string): number | null => {
    const v = get(k);
    if (!v) return null;
    const negative = /^\(.*\)$|^-/.test(v);
    try {
      const cents = parseMoneyToCents(v.replace(/^[(-]|\)$/g, ""));
      return negative ? -cents : cents;
    } catch (e) {
      if (e instanceof MoneyError) reasons.push(`${label} "${v}" is not an amount`);
      else throw e;
      return null;
    }
  };
  const priceCents = money("plan_price", "Price");
  const balanceCents = money("balance", "Balance") ?? 0;
  const nextRaw = get("next_service");
  const nextService = nextRaw ? importDate(nextRaw) : null;
  if (nextRaw && !nextService) reasons.push(`Next service "${nextRaw}" is not a date`);
  if (planId && !nextService) warnings.push("No next service date: the plan starts today");
  const statusRaw = (get("status") ?? "active").toLowerCase();
  const active = !/^(inactive|cancel+ed|no|false|0|closed)$/.test(statusRaw);

  if (reasons.length) return { ok: false, reasons };
  const externalRef = get("external_ref") ?? rowKey(displayName, line1!, zip!);
  return {
    ok: true,
    warnings,
    row: {
      externalRef,
      kind: company && !first && !last ? "commercial" : "residential",
      firstName: first,
      lastName: last,
      companyName: company,
      displayName: displayName.slice(0, 200),
      email,
      phone,
      altPhone,
      line1: line1!,
      line2: get("address_line2"),
      city: city!,
      region: region!,
      postalCode: zip!,
      accessNotes: get("access_notes"),
      notes: get("notes"),
      planId: active ? planId : null,
      priceCents,
      nextService,
      balanceCents,
      active,
    },
  };
}
