import type { Metadata } from "next";
import { canManage, OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";
import { formatPhone } from "@/lib/domain/contact";
import { BusinessForm } from "./forms";

export const metadata: Metadata = { title: "Business settings" };

export default async function BusinessSettingsPage() {
  const member = await requireMember(OFFICE_ROLES);
  const { tenant, office } = await withRls(member.claims, async (tx) => ({
    tenant: await tx.selectFrom("tenants").select(["name", "business_license_no", "state", "timezone"]).executeTakeFirstOrThrow(),
    office: await tx.selectFrom("offices").select(["address_line1", "address_line2", "city", "postal_code", "phone"]).where("is_primary", "=", true).executeTakeFirst(),
  }));

  return (
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
  );
}
