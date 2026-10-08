import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetError } from "./parse";
import { parseXlsx } from "./xlsx";

// FR-MIG-02: a workbook as Excel writes it, built by hand.
function workbook(sheet: string, opts: { shared?: string[]; date1904?: boolean } = {}) {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8(
      `<workbook xmlns:r="r"><workbookPr${opts.date1904 ? ' date1904="1"' : ""}/><sheets><sheet name="Customers" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/sharedStrings.xml": strToU8(`<sst>${(opts.shared ?? []).map((s) => `<si>${s}</si>`).join("")}</sst>`),
    "xl/styles.xml": strToU8('<styleSheet><numFmts><numFmt numFmtId="164" formatCode="m/d/yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/></cellXfs></styleSheet>'),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${sheet}</sheetData></worksheet>`),
  });
}

describe("parseXlsx", () => {
  it("reads shared and rich text, numbers as typed, dates, blanks and skipped columns", () => {
    const xlsx = workbook(
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="inlineStr"><is><t>Next</t></is></c></row>
       <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>8015550142</v></c><c r="D2" s="1"><v>46317</v></c></row>
       <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3"><v>4.5</v></c><c r="C3" t="str"><v>O&apos;Neil &amp; Co</v></c><c r="D3" s="2"><v>46318</v></c></row>
       <row r="4"/>`,
      { shared: ["<t>Name</t>", "<t>Phone</t>", "<t>Notes</t>", "<r><t>Marisol </t></r><r><t>Quintero</t></r>", "<t>Bo Lin</t>"] },
    );
    expect(parseXlsx(xlsx)).toEqual({
      headers: ["Name", "Phone", "Notes", "Next"],
      rows: [
        ["Marisol Quintero", "8015550142", "", "2026-10-22"],
        ["Bo Lin", "4.5", "O'Neil & Co", "2026-10-23"],
      ],
    });
  });

  it("honours the 1904 date system", () => {
    const xlsx = workbook('<row r="1"><c r="A1" t="inlineStr"><is><t>When</t></is></c></row><row r="2"><c r="A2" s="1"><v>0</v></c></row>', { date1904: true });
    expect(parseXlsx(xlsx).rows).toEqual([["1904-01-01"]]);
  });

  it("refuses files that are not workbooks", () => {
    expect(() => parseXlsx(strToU8("Name,Phone\nBo,1"))).toThrow(SheetError);
    expect(() => parseXlsx(zipSync({ "a.txt": strToU8("x") }))).toThrow(/not an Excel workbook/);
  });
});
