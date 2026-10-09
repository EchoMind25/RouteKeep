import { ArrowRight } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { cn } from "@/lib/cn";

// The two buttons the public pages use (FR-WEB-01). "Get started" always goes
// to sign-in, where a new email sets up a business (onboarding).

export function Cta({ className, children = "Get started" }: { className?: string; children?: React.ReactNode }) {
  return (
    <Link
      href="/sign-in"
      className={cn(
        "inline-flex h-12 items-center justify-center gap-2 rounded-control bg-accent px-6 text-md font-semibold whitespace-nowrap text-on-accent transition-transform hover:bg-accent-hover active:scale-[0.98]",
        className,
      )}
    >
      {children} <ArrowRight size={18} weight="bold" aria-hidden />
    </Link>
  );
}

export function SecondaryCta({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const style = cn("inline-flex h-12 items-center justify-center rounded-control border border-line-strong px-6 text-md font-semibold whitespace-nowrap hover:bg-surface", className);
  // mailto: and in-page anchors are plain links; site pages go through the router.
  return href.startsWith("/") && !href.startsWith("/#") ? (
    <Link href={href} className={style}>
      {children}
    </Link>
  ) : (
    <a href={href} className={style}>
      {children}
    </a>
  );
}
