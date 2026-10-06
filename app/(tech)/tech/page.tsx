import { NavigationArrow, SignOut } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { BrandMark } from "@/components/brand-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth/session";
import { formatAddress } from "@/lib/domain/contact";
import { todayIn } from "@/lib/domain/time";
import { getMyDay } from "@/lib/server/schedule";
import { APPOINTMENT_STATUS, formatLocalDate, formatWindow } from "@/lib/ui/format";
import { signOut } from "../../(auth)/sign-in/actions";

export const metadata: Metadata = { title: "My route" };

// Online view of the technician's day. The offline stop flow (FR-TEC-01..11)
// replaces this page in M3; until then it needs a connection and says so.
export default async function TechDayPage() {
  const member = await requireMember();
  const today = todayIn(member.timezone);
  const { technician, stops } = await getMyDay(member, today);

  return (
    <div className="mx-auto grid min-h-dvh max-w-xl content-start gap-5 px-4 py-5">
      <header className="flex items-center justify-between gap-3">
        <BrandMark />
        <form action={signOut}>
          <Button variant="ghost" size="sm" type="submit">
            <SignOut size={16} aria-hidden /> Sign out
          </Button>
        </form>
      </header>

      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{formatLocalDate(today, "long")}</h1>
        <p className="text-fg-muted">{technician ? `${technician.display_name}, ${stops.length} ${stops.length === 1 ? "stop" : "stops"}` : member.tenantName}</p>
      </div>

      <Alert tone="warning">This view needs a connection. The offline technician app with the full stop flow is coming next.</Alert>

      {!technician ? (
        <EmptyState title="Your login is not linked to a technician yet">Ask the office to link your account to your technician profile.</EmptyState>
      ) : stops.length === 0 ? (
        <EmptyState title="No stops today">Enjoy the day. New stops appear here when the office assigns them.</EmptyState>
      ) : (
        <ol className="grid gap-3">
          {stops.map((s, i) => {
            const address = formatAddress({ line1: s.address_line1, city: s.city, region: s.region, postalCode: s.postal_code });
            const st = APPOINTMENT_STATUS[s.status] ?? APPOINTMENT_STATUS.scheduled!;
            return (
              <li key={s.id} className="grid gap-3 rounded-panel border border-line bg-surface p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-pill bg-fg text-md font-bold text-canvas tabular" aria-label={`Stop ${s.sequence ?? i + 1}`}>
                    {s.sequence ?? i + 1}
                  </span>
                  <div className="grid min-w-0 gap-0.5">
                    <p className="text-md font-semibold">{s.customer_name}</p>
                    <p className="text-fg-muted">{address}</p>
                    <p className="text-sm text-fg-muted tabular">
                      {formatWindow(s.window_start, s.window_end)}, {s.service_type_name}
                    </p>
                  </div>
                  {s.status !== "scheduled" ? <Badge tone={st.tone} className="ml-auto">{st.label}</Badge> : null}
                </div>
                {s.access_notes ? <p className="rounded-control bg-sunken px-3 py-2 text-sm">{s.access_notes}</p> : null}
                {/* FR-TEC-10: one tap to the device's maps app. */}
                <Button asChild size="lg" variant="secondary" className="w-full">
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer">
                    <NavigationArrow size={20} aria-hidden /> Navigate
                  </a>
                </Button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
