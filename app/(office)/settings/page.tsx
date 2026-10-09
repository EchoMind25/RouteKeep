import type { Metadata } from "next";
import { canManage, OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import { formatPhone } from "@/lib/domain/contact";
import { BusinessForm } from "./forms";
import { BrandForm } from "./brand/brand-form";
import { LogoForm } from "./logo/logo-form";
import { DataSharingForm } from "./data-sharing/data-sharing-form";
import { isSharingLevel, DEFAULT_SHARING } from "@/lib/domain/data-sharing";

export const metadata: Metadata = { title: "Business settings" };

export default async function BusinessSettingsPage() {
  const member = await requireMember(OFFICE_ROLES);
  const { tenant, office } = await withRls(member.claims, async (tx) => ({
    tenant: await tx.selectFrom("tenants").select(["name", "business_license_no", "state", "timezone", "logo_path", "updated_at", "white_label_at", "brand_accent", "data_sharing", "data_sharing_changed_at"]).executeTakeFirstOrThrow(),
    office: await tx.selectFrom("offices").select(["address_line1", "address_line2", "city", "postal_code", "phone"]).where("is_primary", "=", true).executeTakeFirst(),
  }));
  const changed = tenant.data_sharing_changed_at
    ? `Last saved ${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: tenant.timezone }).format(new Date(tenant.data_sharing_changed_at))}.`
    : "Not answered yet, so nothing is shared.";

  return (
    <>
    <BusinessForm
      readOnly={!canManage(member.role)}
      initial={{
        name: tenant.name,
        businessLicenseNo: tenant.business_license_no,
        state: tenant.state,
        timezone: tenant.timezone,
        addressLine1: office?.address_line1 ?? "",
        addressLine2: office?.address_line2 ?? "",
        city: office?.city ?? "",
        postalCode: office?.postal_code ?? "",
        phone: formatPhone(office?.phone),
      }}
    />
    {/* FR-BRD-02 */}
    <LogoForm hasLogo={Boolean(tenant.logo_path)} version={new Date(tenant.updated_at).getTime().toString(36)} readOnly={!canManage(member.role)} />
    {/* FR-BRD-03: only once white label is on (D-14). */}
    {tenant.white_label_at ? <BrandForm accent={tenant.brand_accent} readOnly={!canManage(member.role)} /> : null}
    {/* OPS-04 */}
    <DataSharingForm answered={tenant.data_sharing_changed_at !== null} level={isSharingLevel(tenant.data_sharing) ? tenant.data_sharing : DEFAULT_SHARING} changedLabel={changed} readOnly={!canManage(member.role)} />
    </>
  );
}
