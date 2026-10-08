// NFR accessibility (WCAG 2.3.3): animation driven from script has to honour the
// reduced-motion setting itself, because CSS media queries do not reach it.

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
