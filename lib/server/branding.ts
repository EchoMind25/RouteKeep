import "server-only";
import { cache } from "react";
import type { MemberSession } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";

// FR-BRD-03: how the app presents itself to this business's people.
export interface TenantBranding {
  whiteLabel: boolean;
  name: string;
  hasLogo: boolean;
  accent: string | null;
}

// Once per request: the office layout and its generateMetadata both ask, with
// the same session object (getMemberSession is itself cached per request).
export const tenantBranding = cache(async (m: MemberSession): Promise<TenantBranding> =>
  withRls(m.claims, async (tx) => {
    const t = await tx.selectFrom("tenants").select(["name", "logo_path", "white_label_at", "brand_accent"]).executeTakeFirstOrThrow();
    return { whiteLabel: t.white_label_at !== null, name: t.name, hasLogo: Boolean(t.logo_path), accent: t.white_label_at ? t.brand_accent : null };
  }),
);

export async function saveBrandAccent(m: MemberSession, accent: string | null) {
  await withRls(m.claims, (tx) => tx.updateTable("tenants").set({ brand_accent: accent }).where("id", "=", m.tenantId).execute());
}
