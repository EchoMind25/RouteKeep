// FR-MIG-02, FR-MIG-08: reading the spreadsheets owners export from other
// software. RFC 4180 with the usual real-world deviations: a byte order mark,
// CRLF or LF line ends, quoted fields holding commas and line breaks, doubled
// quotes, ragged rows, blank trailing lines, and our own export's apostrophe
// guard against spreadsheet formulas (lib/csv.ts), which is undone here.

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

export class SheetError extends Error {}

export function parseCsv(text: string, opts: { maxRows?: number } = {}): ParsedSheet {
  const maxRows = opts.maxRows ?? 50_000;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (!(row.length === 1 && row[0] === "")) out.push(row);
    if (out.length > maxRows + 1) throw new SheetError(`The file has more than ${maxRows.toLocaleString("en-US")} rows. Split it and import each part.`);
    row = [];
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === ",") {
      endCell();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      if (src[i + 1] === "\n") i += 1;
      endRow();
    } else {
      cell += ch;
    }
    i += 1;
  }
  if (quoted) throw new SheetError("A quoted field never closes. The file may be cut off or not a CSV.");
  if (cell !== "" || row.length) endRow();
  if (out.length === 0) throw new SheetError("The file is empty.");

  const headers = out[0]!.map((h, k) => h.trim() || `Column ${k + 1}`);
  const seen = new Map<string, number>();
  for (const [k, h] of headers.entries()) {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    if (n > 1) headers[k] = `${h} (${n})`;
  }
  const rows = out.slice(1).map((r) => headers.map((_, k) => unguard((r[k] ?? "").trim())));
  return { headers, rows: rows.filter((r) => r.some((c) => c !== "")) };
}

/** Our CSV export prefixes formula-like text with an apostrophe; a re-import takes it off. */
function unguard(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}
