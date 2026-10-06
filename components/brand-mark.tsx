import { Path } from "@phosphor-icons/react/ssr";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/cn";

/** Placeholder mark until replica-brand produces the real logo. */
export function BrandMark({ className, withName = true }: { className?: string; withName?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight text-fg", className)}>
      <span className="grid size-7 place-items-center rounded-control bg-accent text-on-accent" aria-hidden>
        <Path size={17} weight="bold" />
      </span>
      {withName ? <span className="text-md">{BRAND.name}</span> : <span className="sr-only">{BRAND.name}</span>}
    </span>
  );
}
