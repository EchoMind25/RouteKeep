import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PinEditor } from "@/components/map/pin-editor";
import { PageHeader } from "@/components/ui/layout";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { isLocalDate } from "@/lib/domain/time";
import { publicEnv } from "@/lib/public-env";
import { getPropertyPin } from "@/lib/server/customers";
import { formatLocalDate } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Check the pin" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** With no pin and no office location, start over the middle of Utah County (the first market). */
const FALLBACK_CENTER = { lat: 40.3, lng: -111.7 };

export default async function PinPage({ params, searchParams }: { params: Promise<{ id: string; propertyId: string }>; searchParams: Promise<{ date?: string }> }) {
  const member = await requireMember(OFFICE_ROLES);
  const { id, propertyId } = await params;
  if (!UUID.test(id) || !UUID.test(propertyId)) notFound();
  const data = await getPropertyPin(member, id, propertyId);
  if (!data) notFound();
  const { property: p, office } = data;
  const { date: raw } = await searchParams;
  const date = raw && isLocalDate(raw) ? raw : null;
  const address = [p.address_line1, p.address_line2, `${p.city}, ${p.region} ${p.postal_code}`].filter(Boolean).join(", ");

  return (
    <div className="grid gap-2">
      <PageHeader
        title="Check the pin"
        description={`${p.customer_name}, ${address}`}
        back={
          <Link href={date ? `/schedule?date=${date}` : `/customers/${id}`} className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
            <ArrowLeft size={14} aria-hidden /> {date ? `Back to ${formatLocalDate(date)}` : "Back to customer"}
          </Link>
        }
      />
      <PinEditor
        customerId={id}
        propertyId={p.id}
        version={p.version}
        date={date}
        pin={p.lat !== null && p.lng !== null ? { lat: p.lat, lng: p.lng } : null}
        center={office ?? FALLBACK_CENTER}
        confidence={p.geocode_confidence === null ? null : Number(p.geocode_confidence)}
        source={p.geocode_source}
        confirmed={p.location_confirmed_at !== null}
        locked={p.location_locked}
        styleUrl={publicEnv.mapStyleUrl}
      />
    </div>
  );
}
