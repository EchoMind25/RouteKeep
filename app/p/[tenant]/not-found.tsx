// FR-BRD-03: neutral on purpose. This page can be shown for a white-label
// business, so it carries no RouteVerde name or mark.
export default function PortalNotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center justify-items-start gap-5 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">This page isn&apos;t available</h1>
      <p className="text-fg-muted">The link may be out of date. Check the address, or ask the business for a new link.</p>
    </main>
  );
}
