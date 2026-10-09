import type { Metadata } from "next";
import { canManage, INVENTORY_ROLES, requireMember } from "@/lib/auth/session";
import { getInventorySettings } from "@/lib/server/inventory";
import { InventorySettingsForm } from "./form";

export const metadata: Metadata = { title: "Inventory settings" };

// FR-INV-01. Owner and admin change it; office can read it.
export default async function InventorySettingsPage() {
  const member = await requireMember(INVENTORY_ROLES);
  const settings = await getInventorySettings(member);
  return <InventorySettingsForm readOnly={!canManage(member.role)} initial={{ mode: settings.mode, resupplyWeekday: settings.resupplyWeekday === null ? "" : String(settings.resupplyWeekday) }} />;
}
