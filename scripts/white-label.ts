// D-14, FR-BRD-03: switch white label on or off for one business (the platform
// does this after the white label sale), optionally with its colour.
//   npm run white-label -- <tenant id> on [#0b3d2e]
//   npm run white-label -- <tenant id> off
import { sql } from "kysely";
import { withServiceRole } from "@/lib/db/service";

const [tenantId, mode, accent] = process.argv.slice(2);
if (!tenantId || !/^[0-9a-f-]{36}$/.test(tenantId) || !["on", "off"].includes(mode ?? "") || (accent && !/^#[0-9a-f]{6}$/i.test(accent))) {
  console.error("usage: npm run white-label -- <tenant id> on|off [#rrggbb]");
  process.exit(2);
}
const row = await withServiceRole((tx) =>
  tx
    .updateTable("tenants")
    .set({ white_label_at: mode === "on" ? sql`coalesce(white_label_at, now())` : null, ...(accent ? { brand_accent: accent.toLowerCase() } : {}) })
    .where("id", "=", tenantId)
    .returning(["name", "white_label_at", "brand_accent"])
    .executeTakeFirst(),
);
if (!row) {
  console.error("No business with that id.");
  process.exit(1);
}
console.log(`${row.name}: white label ${row.white_label_at ? "on" : "off"}${row.brand_accent ? `, colour ${row.brand_accent}` : ""}`);
process.exit(0);
