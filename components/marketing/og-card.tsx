import { ImageResponse } from "next/og";
import tokens from "@/replica/design/tokens.json";
import { BRAND } from "@/lib/brand";

// The social card for a public page (FR-WEB-01): the brand, the page's own
// headline and one line under it. Built-in font, nothing fetched. The landing
// page's card is app/opengraph-image.tsx; each guide renders this one.

export const OG_SIZE = { width: 1200, height: 630 };

const c = tokens.color.light;

export function ogCard(headline: string, line: string): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: c.canvas, color: c.fg }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 40, fontWeight: 700 }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: c.accent }} />
          {BRAND.name}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>{headline}</div>
          <div style={{ fontSize: 32, color: c["fg-muted"] }}>{line}</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
