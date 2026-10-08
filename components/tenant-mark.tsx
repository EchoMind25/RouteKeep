import { cn } from "@/lib/cn";

// FR-BRD-03: the business's own mark where the product's would be.
export function TenantMark({ name, logoSrc, className }: { name: string; logoSrc: string | null; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2 font-semibold tracking-tight text-fg", className)}>
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- the business's own logo from private storage
        <img src={logoSrc} alt="" className="max-h-8 max-w-24 object-contain" />
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded-control bg-accent text-xs font-bold text-on-accent" aria-hidden>
          {initials}
        </span>
      )}
      <span className="truncate text-md">{name}</span>
    </span>
  );
}
