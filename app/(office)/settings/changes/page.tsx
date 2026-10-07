import type { Metadata } from "next";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { CHANGELOG } from "@/lib/changelog";
import { formatLocalDate } from "@/lib/ui/format";

export const metadata: Metadata = { title: "What's new" };

export default async function ChangesPage() {
  await requireMember(OFFICE_ROLES);
  return (
    <div className="grid max-w-3xl gap-8">
      {CHANGELOG.map((entry) => (
        <section key={entry.date} aria-labelledby={`release-${entry.date}`} className="grid gap-3">
          <div className="grid gap-0.5">
            <p className="text-sm text-fg-muted tabular">{formatLocalDate(entry.date, "full")}</p>
            <h2 id={`release-${entry.date}`} className="text-lg font-semibold">
              {entry.title}
            </h2>
          </div>
          <ul className="grid list-disc gap-2 pl-5 text-fg">
            {entry.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
