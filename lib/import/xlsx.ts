import { strFromU8, unzipSync } from "fflate";
import { SheetError, type ParsedSheet } from "./parse";

// FR-MIG-02: Excel workbooks (.xlsx), read directly: an .xlsx is a zip of XML
// files. Only the first worksheet is read, as text, the way a person sees it:
// numbers keep their digits (a phone stored as a number stays 8015550142),
// date cells become YYYY-MM-DD, formulas give their saved result. Nothing is
// executed. Old .xls files are not supported; save them as .xlsx or CSV.

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))) : (XML_ENTITIES[e] ?? whole),
  );

/** All text inside <t> elements (plain and rich-text runs), in order. */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]!)).join("");

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

// Built-in number formats that are dates (ECMA-376 18.8.30).
const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function dateStyles(styles: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!styles) return out;
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\s[^>]*>/g)) custom.set(Number(attr(m[0], "numFmtId")), decode(attr(m[0], "formatCode") ?? ""));
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  [...xfs.matchAll(/<xf\s[^>]*?\/?>/g)].forEach((m, i) => {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    const code = custom.get(id)?.replace(/"[^"]*"|\[[^\]]*\]/g, "") ?? "";
    if (BUILTIN_DATES.has(id) || /[dy]/i.test(code)) out.add(i);
  });
  return out;
}

function serialToDate(serial: number, date1904: boolean): string {
  // Excel's 1900 system counts a nonexistent 29 Feb 1900; day 60 onward is shifted by it.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function numberText(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  // Whole numbers keep every digit; others drop binary noise (0.1 + 0.2).
  return Number.isInteger(n) ? BigInt(Math.round(n)).toString() : String(Number(n.toPrecision(12)));
}

export function parseXlsx(bytes: Uint8Array, opts: { maxRows?: number } = {}): ParsedSheet {
  const maxRows = opts.maxRows ?? 50_000;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new SheetError("That file could not be opened as an Excel workbook. Save it as .xlsx or CSV and try again.");
  }
  const read = (name: string) => (files[name] ? strFromU8(files[name]!) : undefined);
  const workbook = read("xl/workbook.xml");
  if (!workbook) throw new SheetError("That file is not an Excel workbook (.xlsx). Save it as .xlsx or CSV and try again.");
  const date1904 = /<workbookPr[^>]*date1904="(1|true)"/.test(workbook);
  const firstSheet = /<sheet\s[^>]*>/.exec(workbook)?.[0];
  const relId = firstSheet ? (attr(firstSheet, "r:id") ?? "") : "";
  const rels = read("xl/_rels/workbook.xml.rels") ?? "";
  const rel = [...rels.matchAll(/<Relationship\s[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, "Id") === relId);
  const target = rel ? attr(rel, "Target")! : "worksheets/sheet1.xml";
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const sheet = read(sheetPath);
  if (!sheet) throw new SheetError("The workbook has no worksheet to read.");

  const shared = [...(read("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));
  const dates = dateStyles(read("xl/styles.xml"));

  const grid: string[][] = [];
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const cells: string[] = [];
    for (const c of (row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = ` ${c[1]}`;
      const body = c[2] ?? "";
      const ref = attr(head, "r");
      const col = ref ? columnIndex(ref) : cells.length;
      const type = attr(head, "t") ?? "n";
      const style = Number(attr(head, "s") ?? -1);
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = v === undefined ? "" : (shared[Number(v)] ?? "");
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "str" || type === "e") value = v === undefined ? "" : decode(v);
      else if (type === "b") value = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
      else if (v !== undefined) value = dates.has(style) ? serialToDate(Number(v), date1904) : numberText(v);
      cells[col] = value.trim();
    }
    grid.push(Array.from(cells, (x) => x ?? ""));
    if (grid.length > maxRows + 1) throw new SheetError(`The file has more than ${maxRows.toLocaleString("en-US")} rows. Split it and import each part.`);
  }
  const nonEmpty = grid.filter((r) => r.some((x) => x !== ""));
  if (nonEmpty.length === 0) throw new SheetError("The first worksheet is empty.");
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, k) => nonEmpty[0]![k]?.trim() || `Column ${k + 1}`);
  const seen = new Map<string, number>();
  for (const [k, h] of headers.entries()) {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    if (n > 1) headers[k] = `${h} (${n})`;
  }
  return { headers, rows: nonEmpty.slice(1).map((r) => headers.map((_, k) => r[k] ?? "")) };
}
