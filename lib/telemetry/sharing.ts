import "server-only";
import { cache } from "react";
import type { DbClaims, PortalClaims } from "@/lib/db/rls";
import { withPortal, withRls } from "@/lib/db/rls";
import { errorText, log } from "@/lib/observability/log";

// OPS-04: whether a layout may load the browser error reporter. At `none` the
// reporter is not rendered at all. Fails closed: if the level cannot be read,
// the answer is "none".

export type DataSharing = "none" | "anonymous" | "identified";

function level(v: unknown): DataSharing {
  return v === "anonymous" || v === "identified" ? v : "none";
}

/** The signed-in member's business setting, read with their own claims. */
export const memberDataSharing = cache(async (claims: DbClaims): Promise<DataSharing> => {
  if (!claims.tenant_id) return "none";
  try {
    const row = await withRls(claims, (tx) => tx.selectFrom("tenants").select("data_sharing").where("id", "=", claims.tenant_id!).executeTakeFirst());
    return level(row?.data_sharing);
  } catch (error) {
    log.warn("data sharing unreadable", { error: errorText(error).slice(0, 200) });
    return "none";
  }
});

/** The business setting behind a signed-in portal customer. */
export const portalDataSharing = cache(async (claims: PortalClaims): Promise<DataSharing> => {
  try {
    const row = await withPortal(claims, (tx) => tx.selectFrom("tenants").select("data_sharing").executeTakeFirst());
    return level(row?.data_sharing);
  } catch (error) {
    log.warn("data sharing unreadable", { error: errorText(error).slice(0, 200) });
    return "none";
  }
});
