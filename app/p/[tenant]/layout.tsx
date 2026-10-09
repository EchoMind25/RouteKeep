import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BrandTheme } from "@/components/brand-theme";
import { BRAND } from "@/lib/brand";
import { isEnabled } from "@/lib/flags";
import { publicBusiness } from "@/lib/portal/data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  const { tenant } = await params;
  const business = UUID.test(tenant) ? await publicBusiness(tenant) : null;
  return { title: { absolute: business ? `${business.name}: your account` : "Your account" }, robots: { index: false, follow: false } };
}

// FR-POR-01/02, FR-BRD-03: the customer's side, under the business's name.
// A small product credit sits at the foot unless the business is white label.
export default async function PortalLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  if (!isEnabled("portal") || !UUID.test(tenant)) notFound();
  const business = await publicBusiness(tenant);
  if (!business) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <div className="min-h-dvh bg-canvas text-fg">
      {business.whiteLabel ? <BrandTheme accent={business.accent} nonce={nonce} /> : null}
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-30 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          {business.logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element -- the business's own logo from its storage
            <img src={`/p/${tenant}/logo`} alt="" className="max-h-10 max-w-32 object-contain" />
          ) : null}
          <p className="text-lg font-semibold">{business.name}</p>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="focus:outline-none mx-auto grid max-w-3xl gap-8 px-4 py-8">
        {children}
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-10 text-sm text-fg-muted">
        {business.phone ? <p>Questions? Call {business.name} at {business.phone}.</p> : null}
        {business.whiteLabel ? null : <p className="pt-2">Powered by {BRAND.name}</p>}
      </footer>
    </div>
  );
}
