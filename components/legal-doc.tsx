import type { ReactNode } from "react";

// Long-form legal text: readable measure, real headings, nothing clever.
export function LegalDoc({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="grid gap-6 [&_h2]:pt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_li]:ml-5 [&_li]:list-disc [&_p]:max-w-[70ch] [&_p]:text-md [&_ul]:grid [&_ul]:max-w-[70ch] [&_ul]:gap-2 [&_ul]:text-md">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-fg-muted">Last updated {updated}</p>
      </header>
      {children}
    </article>
  );
}
