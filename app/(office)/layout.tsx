import { SignOut } from "@phosphor-icons/react/ssr";
import { BrandMark } from "@/components/brand-mark";
import { OfficeNav } from "@/components/office/nav";
import { Button } from "@/components/ui/button";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { isEnabled } from "@/lib/flags";
import { signOut } from "../(auth)/sign-in/actions";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", office: "Office", dispatcher: "Dispatcher", technician: "Technician" } as const;

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const member = await requireMember(OFFICE_ROLES);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 z-20 border-b border-line bg-surface lg:h-dvh lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 pt-3 lg:block lg:px-4 lg:pt-5">
          <BrandMark />
          <form action={signOut} className="lg:hidden">
            <Button variant="ghost" size="sm" type="submit">
              <SignOut size={16} aria-hidden /> Sign out
            </Button>
          </form>
        </div>
        <div className="px-3 py-3 lg:px-3 lg:pt-6">
          <OfficeNav enabled={{ billing: isEnabled("billing"), reports: isEnabled("reports") }} />
        </div>
        <div className="hidden border-t border-line px-4 py-4 lg:absolute lg:inset-x-0 lg:bottom-0 lg:grid lg:gap-3">
          <div className="grid gap-0.5">
            <p className="truncate font-medium text-fg" title={member.tenantName}>
              {member.tenantName}
            </p>
            <p className="truncate text-sm text-fg-muted" title={member.email ?? undefined}>
              {member.email} <span aria-hidden>|</span> {ROLE_LABEL[member.role]}
            </p>
          </div>
          <form action={signOut}>
            <Button variant="secondary" size="sm" type="submit" className="w-full">
              <SignOut size={16} aria-hidden /> Sign out
            </Button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-[1200px]">{children}</div>
      </main>
    </div>
  );
}
