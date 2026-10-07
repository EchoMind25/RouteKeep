import type { StyleSpecification } from "maplibre-gl";

// Shared by every map: the light/dark subscription and the no-basemap style.

const DARK = "(prefers-color-scheme: dark)";

export function subscribeScheme(onChange: () => void) {
  const media = window.matchMedia(DARK);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function currentScheme(): "dark" | "light" {
  return window.matchMedia(DARK).matches ? "dark" : "light";
}

/** A design token's current value, e.g. cssVar("--rk-sunken"). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** No basemap: pins and lines on a plain background, and no tile requests at all. */
export function blankStyle(background: string): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": background } }] };
}
