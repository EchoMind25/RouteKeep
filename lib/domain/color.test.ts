import { describe, expect, it } from "vitest";
import { contrast, paletteFor, parseHex } from "./color";

const LIGHT = parseHex("#fbfbfc")!;
const LIGHT_CANVAS = parseHex("#f4f5f7")!;
const DARK = parseHex("#161a1f")!;
const DARK_CANVAS = parseHex("#0f1216")!;

describe("brand palettes (FR-BRD-03, NFR-05)", () => {
  it.each(["#ffd400", "#00a2ff", "#0b3d2e", "#ff0000", "#7c3aed", "#ffffff", "#000000"])("%s stays readable in light and dark", (hex) => {
    for (const [surface, canvas, dark] of [[LIGHT, LIGHT_CANVAS, false], [DARK, DARK_CANVAS, true]] as const) {
      const p = paletteFor(parseHex(hex)!, surface, dark, canvas);
      for (const bg of [surface, canvas, parseHex(p.accentSoft)!]) expect(contrast(parseHex(p.accent)!, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseHex(p.onAccent)!, parseHex(p.accent)!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("leaves a colour that already passes alone", () => {
    expect(paletteFor(parseHex("#0b3d2e")!, LIGHT, false).accent).toBe("#0b3d2e");
  });

  it("refuses what is not a hex colour", () => {
    expect(parseHex("green")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
  });
});
