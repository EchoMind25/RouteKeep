import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge has to know our token names, or it would treat text-md (a
// size) and text-fg (a colour) as the same group and drop one of them.
const twMerge = extendTailwindMerge({
  override: {
    theme: {
      color: [
        "canvas", "surface", "sunken", "line", "line-strong", "fg", "fg-muted",
        "accent", "accent-hover", "accent-soft", "on-accent",
        "danger", "danger-soft", "success", "success-soft", "warning", "warning-soft",
        "focus", "transparent", "current",
      ],
      text: ["xs", "sm", "base", "md", "lg", "xl", "2xl"],
      radius: ["control", "panel", "pill"],
      shadow: ["raised", "overlay"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
