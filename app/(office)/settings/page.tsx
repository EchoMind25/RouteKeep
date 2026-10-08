import type { Metadata } from "next";
import { canManage, OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import { formatPhone } from "@/lib/domain/contact";
import { BusinessForm } from "./forms";
import { BrandForm } from "./brand/brand-form";
import { LogoForm } from "./logo/logo-form";

export const metadata: Metadata = { title: "Business settings" };

export default async function BusinessSettingsPage() {
  const member = await requireMember(OFFICE_ROLES);
  const { tenant, office } = await withRls(member.claims, async (tx) => ({
    tenant: await tx.selectFrom("tenants").select(["name", "business_license_no", "state", "timezone", "logo_path", "updated_at", "white_label_at", "brand_accent"]).executeTakeFirstOrThrow(),
    office: await tx.selectFrom("offices").select(["address_line1", "address_line2", "city", "postal_code", "phone"]).where("is_primary", "=", true).executeTakeFirst(),
  }));

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
    </>
  );
}
