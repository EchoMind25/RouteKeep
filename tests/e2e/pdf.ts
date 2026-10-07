import { inflateSync } from "node:zlib";

/** The text of a PDF made with the built-in fonts: inflate each stream, read its hex strings. */
export function pdfText(pdf: Buffer): string {
  let text = "";
  for (const m of pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      const content = inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
      text += [...content.matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => Buffer.from(h[1]!, "hex").toString("latin1")).join("");
    } catch {
      // Not a content stream (an image, a font): nothing to read.
    }
  }
  return text;
}
