// FR-BRD-03, NFR-05: a white label business's own colour, made safe to use.
// The app uses the accent for buttons (text on the accent) and for links and
// numbers (the accent as text on a surface), so both must reach WCAG AA
// (4.5:1). A colour that does not is darkened (light themes) or lightened
// (dark theme) step by step until it does; its hue stays recognisable.

export type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(rgb: Rgb): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

export interface Palette {
  accent: string;
  accentHover: string;
  accentSoft: string;
  onAccent: string;
}

/**
 * One theme's accent set. The accent is used as text on the surface, on the
 * page canvas and on its own soft tint (an active menu item), so it must reach
 * 4.5:1 against all three; text on the accent must reach it too.
 */
export function paletteFor(brand: Rgb, surface: Rgb, dark: boolean, canvas: Rgb = surface): Palette {
  const toward = dark ? WHITE : BLACK;
  let accent = brand;
  let soft = mix(surface, accent, dark ? 0.22 : 0.1);
  for (let t = 0; t <= 1; t += 0.03) {
    accent = mix(brand, toward, t);
    soft = mix(surface, accent, dark ? 0.22 : 0.1);
    if ([surface, canvas, soft].every((bg) => contrast(accent, bg) >= 4.5)) break;
  }
  const onAccent = contrast(WHITE, accent) >= contrast(BLACK, accent) ? WHITE : BLACK;
  const hover = mix(accent, toward, 0.15);
  return { accent: toHex(accent), accentHover: toHex(hover), accentSoft: toHex(soft), onAccent: toHex(onAccent) };
}

export function cssVars(p: Palette): string {
  return `--rk-accent:${p.accent};--rk-accent-hover:${p.accentHover};--rk-accent-soft:${p.accentSoft};--rk-on-accent:${p.onAccent};--rk-focus:${p.accent};`;
}
