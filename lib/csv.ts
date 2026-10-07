// CSV for exports (FR-REC-06, later FR-EXP-01): RFC 4180 quoting, CRLF line
// ends, and a byte order mark so Excel reads accented names as UTF-8.

export type Cell = string | number | null | undefined;

// A spreadsheet runs a cell starting with one of these as a formula; such text
// is prefixed with an apostrophe (OWASP, CSV injection). Numbers are written as
// numbers and never prefixed.
const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = FORMULA.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly (readonly Cell[])[]): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
