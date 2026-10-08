import tokens from "@/replica/design/tokens.json";
import { cssVars, paletteFor, parseHex } from "@/lib/domain/color";

// FR-BRD-03: a white label business's colour across the app, in every theme,
// adjusted to stay readable (lib/domain/color.ts). Renders nothing for an
// invalid or missing colour, so the product's own palette stays.
export function BrandTheme({ accent }: { accent: string | null }) {
  const brand = accent ? parseHex(accent) : null;
  if (!brand) return null;
  const theme = (t: "light" | "dark" | "outdoor") => cssVars(paletteFor(brand, parseHex(tokens.color[t].surface)!, t === "dark", parseHex(tokens.color[t].canvas)!));
  const [light, dark, outdoor] = [theme("light"), theme("dark"), theme("outdoor")];
  const css = `:root{${light}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]):not([data-theme="outdoor"]){${dark}}}:root[data-theme="dark"]{${dark}}:root[data-theme="outdoor"]{${outdoor}}`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
