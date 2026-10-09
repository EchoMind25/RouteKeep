import { SignOut, Wrench } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { BrandMark } from "@/components/brand-mark";
import { BrandTheme } from "@/components/brand-theme";
import { TenantMark } from "@/components/tenant-mark";
import { tenantBranding } from "@/lib/server/branding";
import { OfficeNav } from "@/components/office/nav";
import { ErrorReporter } from "@/components/telemetry/error-reporter";
import { Button } from "@/components/ui/button";
import { isDeveloperUser, OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { isEnabled } from "@/lib/flags";
import { memberDataSharing } from "@/lib/telemetry/sharing";
import { signOut } from "../(auth)/sign-in/actions";

// FR-BRD-03: the browser tab names the business, not the product, for white label.
export async function generateMetadata(): Promise<Metadata> {
  const member = await requireMember(OFFICE_ROLES);
  const brand = await tenantBranding(member);
  return brand.whiteLabel ? { title: { template: `%s | ${brand.name}`, default: brand.name }, applicationName: brand.name } : {};
}

const ROLE_LABEL = { owner: "Owner", admin: "Admin", office: "Office", dispatcher: "Dispatcher", technician: "Technician" } as const;

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const member = await requireMember(OFFICE_ROLES);
  // FR-BRD-03: white label shows the business's name, logo and colour, not ours.
  const brand = await tenantBranding(member);
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const developer = await isDeveloperUser();
  // OPS-04: no reporter at all for a business that shares no product data.
  const reportErrors = (await memberDataSharing(member.claims)) !== "none";

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      {brand.whiteLabel ? <BrandTheme accent={brand.accent} nonce={nonce} /> : null}
      {reportErrors ? <ErrorReporter /> : null}
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-30 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <aside className="sticky top-0 z-20 border-b border-line bg-surface lg:h-dvh lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 pt-3 lg:block lg:px-4 lg:pt-5">
          {brand.whiteLabel ? <TenantMark name={brand.name} logoSrc={brand.hasLogo ? "/api/branding/logo" : null} /> : <BrandMark />}
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
          {developer ? (
            <Button asChild variant="ghost" size="sm" className="w-full">
              <Link href="/developer">
                <Wrench size={16} aria-hidden /> Developer console
              </Link>
            </Button>
          ) : null}
          <form action={signOut}>
            <Button variant="secondary" size="sm" type="submit" className="w-full">
              <SignOut size={16} aria-hidden /> Sign out
            </Button>
          </form>
        </div>
      </aside>
      <main id="main" tabIndex={-1} className="min-w-0 px-4 py-6 focus:outline-none sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-[1200px]">{children}</div>
      </main>
    </div>
  );
}
