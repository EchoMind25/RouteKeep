import "server-only";
import type { Tx } from "@/lib/db/rls";
import { formatAddress } from "@/lib/domain/contact";

/** CR-03: the business as it heads records, reports and notices. */
export interface BusinessHeader {
  name: string;
  licenseNo: string;
  state: string;
  timezone: string;
  address: string;
  /** FR-BRD-03: white label bought (D-14); no product credit anywhere customers look. */
  whiteLabel: boolean;
}

export async function businessHeader(tx: Tx): Promise<BusinessHeader> {
  const tenant = await tx.selectFrom("tenants").select(["name", "business_license_no", "state", "timezone", "white_label_at"]).executeTakeFirstOrThrow();
  const office = await tx
    .selectFrom("offices")
    .select(["address_line1", "address_line2", "city", "region", "postal_code"])
    .where("is_primary", "=", true)
    .executeTakeFirst();
  return {
    name: tenant.name,
    licenseNo: tenant.business_license_no,
    state: tenant.state,
    timezone: tenant.timezone,
    whiteLabel: tenant.white_label_at !== null,
    address: office ? formatAddress({ line1: office.address_line1, line2: office.address_line2, city: office.city, region: office.region, postalCode: office.postal_code }) : "",
  };
}
