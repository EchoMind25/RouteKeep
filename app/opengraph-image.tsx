import { ImageResponse } from "next/og";
import tokens from "@/replica/design/tokens.json";
import { BRAND } from "@/lib/brand";

// The card shown when the landing page is shared. Built-in font, nothing fetched.
export const alt = `${BRAND.name}: pest and lawn software that works in a dead zone`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const c = tokens.color.light;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: c.canvas, color: c.fg }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 40, fontWeight: 700 }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: c.accent }} />
          {BRAND.name}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>Pest and lawn software that works in a dead zone.</div>
          <div style={{ fontSize: 32, color: c["fg-muted"] }}>Routes, scheduling, spray records and an offline tech app. Month to month.</div>
        </div>
      </div>
    ),
    size,
  );
}
