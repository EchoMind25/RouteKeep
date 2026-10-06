import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A raised surface. Use only when elevation carries meaning; otherwise group with spacing. */
export function Panel({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-panel border border-line bg-surface shadow-raised", className)} {...props} />;
}

export function PanelHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4", className)}>
      <div className="grid gap-0.5">
        <h2 className="text-md font-semibold text-fg">{title}</h2>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="grid gap-1">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description ? <p className="max-w-[65ch] text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid justify-items-start gap-3 rounded-panel border border-dashed border-line-strong px-6 py-10 md:px-10", className)}>
      {icon ? <div className="text-fg-muted">{icon}</div> : null}
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      {children ? <div className="max-w-[60ch] text-fg-muted">{children}</div> : null}
      {action ? <div className="flex flex-wrap gap-2 pt-1">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-sunken", className)} />;
}

export function Alert({ tone = "neutral", title, children, className }: { tone?: "neutral" | "danger" | "warning" | "success"; title?: ReactNode; children?: ReactNode; className?: string }) {
  const tones = {
    neutral: "border-line bg-sunken text-fg",
    danger: "border-danger/30 bg-danger-soft text-danger",
    warning: "border-warning/30 bg-warning-soft text-warning",
    success: "border-success/30 bg-success-soft text-success",
  } as const;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("grid gap-1 rounded-control border px-4 py-3", tones[tone], className)}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "text-sm" : undefined}>{children}</div> : null}
    </div>
  );
}

/** Label/value pairs, e.g. a customer's contact details. */
export function Details({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]", className)}>
      {items.map((item, i) => (
        <div key={i} className="contents">
          <dt className="text-sm text-fg-muted">{item.label}</dt>
          <dd className="text-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
