import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("CSV export (FR-REC-06)", () => {
  it("quotes only where needed and doubles quotes", () => {
    expect(csvCell("Orem")).toBe("Orem");
    expect(csvCell("1450 S Sandhill Rd, Orem")).toBe('"1450 S Sandhill Rd, Orem"');
    expect(csvCell('The "big" yard')).toBe('"The ""big"" yard"');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(0.5)).toBe("0.5");
  });

  it("never lets text run as a spreadsheet formula", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1 801 555 0142")).toBe("'+1 801 555 0142");
    expect(csvCell("@home")).toBe("'@home");
    expect(csvCell(-2)).toBe("-2");
  });

  it("writes a byte order mark and CRLF line ends", () => {
    expect(toCsv([["a", "b"], [1, null]])).toBe("﻿a,b\r\n1,\r\n");
  });
});
