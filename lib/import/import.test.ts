import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import { autoMap, checkRow, importDate, rowKey } from "./customers";
import { parseCsv, SheetError } from "./parse";

// FR-MIG-02, FR-MIG-09, FR-MIG-10: reading and checking customer lists.

describe("parseCsv", () => {
  it("handles a BOM, quotes, embedded commas and line breaks, CRLF and ragged rows", () => {
    const text = '﻿Name,Address,Notes\r\n"Quintero, Marisol","1450 S Sandhill Rd","Gate on left\nDog ""Max"""\r\nBo Lin,22 E Center\r\n\r\n';
    expect(parseCsv(text)).toEqual({
      headers: ["Name", "Address", "Notes"],
      rows: [
        ["Quintero, Marisol", "1450 S Sandhill Rd", 'Gate on left\nDog "Max"'],
        ["Bo Lin", "22 E Center", ""],
      ],
    });
  });

  it("reads back our own export, formula guard included (FR-EXP-03)", () => {
    const csv = toCsv([["display_name", "notes"], ["Ann", "=1+1 looks like a formula"]]);
    expect(parseCsv(csv).rows).toEqual([["Ann", "=1+1 looks like a formula"]]);
  });

  it("names blank and repeated headers and refuses an unclosed quote", () => {
    expect(parseCsv("Phone,,Phone\n1,2,3").headers).toEqual(["Phone", "Column 2", "Phone (2)"]);
    expect(() => parseCsv('a\n"open')).toThrow(SheetError);
    expect(() => parseCsv("")).toThrow(SheetError);
  });
});

describe("autoMap", () => {
  it("matches common header names and recognises unnamed columns by their values", () => {
    const headers = ["Customer #", "First Name", "Last Name", "Service Address", "City", "St", "Zip Code", "Contact", "Plan"];
    const sample = [["1001", "Marisol", "Quintero", "1450 S Sandhill Rd", "Orem", "UT", "84058", "marisol@example.com", "Quarterly pest"]];
    expect(autoMap(headers, sample)).toEqual({
      external_ref: "Customer #",
      first_name: "First Name",
      last_name: "Last Name",
      address_line1: "Service Address",
      city: "City",
      region: "St",
      postal_code: "Zip Code",
      plan_name: "Plan",
      email: "Contact",
    });
  });
});

describe("checkRow", () => {
  const map = { full_name: "Name", phone: "Phone", email: "Email", address_line1: "Street", city: "City", region: "State", postal_code: "Zip", plan_name: "Plan", next_service: "Next", balance: "Owes" } as const;
  const plans = [{ id: "p1", name: "Quarterly Pest", priceCents: 12900 }];
  const base = { Name: "Quintero, Marisol", Phone: "(801) 555-0142", Email: "Marisol@Example.com", Street: "1450 S Sandhill Rd", City: "Orem", State: "Utah", Zip: "84058", Plan: "quarterly pest", Next: "10/14/26", Owes: "$45.50" };

  it("normalises a good row", () => {
    const r = checkRow(base, map, plans);
    expect(r.ok && r.row).toMatchObject({
      firstName: "Marisol",
      lastName: "Quintero",
      displayName: "Marisol Quintero",
      email: "marisol@example.com",
      phone: "+18015550142",
      region: "UT",
      planId: "p1",
      nextService: "2026-10-14",
      balanceCents: 4550,
      externalRef: rowKey("Marisol Quintero", "1450 S Sandhill Rd", "84058"),
    });
  });

  it("lists every reason a row cannot be imported", () => {
    const r = checkRow({ ...base, Name: "", State: "Utopia", Zip: "8405", Plan: "Termite", Next: "soon" }, map, plans);
    expect(r).toEqual({
      ok: false,
      reasons: ["No name", 'State "Utopia" is not a US state', 'Plan "Termite" is not in Settings. Add it, or clear the plan column', 'Next service "soon" is not a date'],
    });
  });

  it("keeps the customer when only a phone or email is bad, with a warning", () => {
    const r = checkRow({ ...base, Phone: "555-0142" }, map, plans);
    expect(r.ok && r.row.phone).toBeNull();
    expect(r.ok && r.warnings[0]).toMatch(/^Phone "555-0142" left out/);
  });

  it("restores a ZIP code's leading zero and reads credits in brackets", () => {
    const r = checkRow({ ...base, Zip: "4057", Owes: "(12.00)" }, map, plans);
    expect(r.ok && r.row.postalCode).toBe("04057");
    expect(r.ok && r.row.balanceCents).toBe(-1200);
  });
});

describe("importDate", () => {
  it("accepts ISO and US dates and refuses impossible ones", () => {
    expect(importDate("2026-02-28")).toBe("2026-02-28");
    expect(importDate("2/29/2028")).toBe("2028-02-29");
    expect(importDate("2/30/2026")).toBeNull();
    expect(importDate("tomorrow")).toBeNull();
  });
});
