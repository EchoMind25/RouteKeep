import { Gear } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { canManage, INVENTORY_ROLES, requireMember } from "@/lib/auth/session";
import { isEnabled } from "@/lib/flags";
import { getInventorySettings } from "@/lib/server/inventory";
import { InventoryNav } from "./inventory-nav";

// FR-INV-01: the Inventory area. When the business has it off, every page here shows what it does and where to turn it on.
export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  if (!isEnabled("inventory")) notFound();
  const member = await requireMember(INVENTORY_ROLES);
  const settings = await getInventorySettings(member);

  if (settings.mode === "off") {
    return (
      <div className="grid gap-2">
        <PageHeader title="Inventory" description="Know what product you will need before you run out." />
        <EmptyState
          title="Inventory is off for your business"
          action={
            <Button asChild>
              <Link href="/settings/inventory">
                <Gear size={18} aria-hidden /> {canManage(member.role) ? "Turn it on in Settings" : "See the setting"}
              </Link>
            </Button>
          }
        >
          <p>
            Forecast mode looks at the visits on your schedule and what past visits used, then tells you how much of each product you will need this week, the next three weeks and the rest of the month. It
            makes a shopping list by vendor, and you can turn it into an order to print or email from your own mail app.
          </p>
          <p className="pt-2">Tracked mode also keeps stock for your shop and each truck, and asks each technician to count their truck on resupply day.</p>
          {canManage(member.role) ? null : <p className="pt-2">Only the owner or an admin can turn it on.</p>}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="print:hidden">
        <PageHeader
          title="Inventory"
          description={settings.mode === "tracked" ? "Forecast, orders and the stock in your shop and on your trucks." : "Forecast and orders. Turn on tracking in Settings to also keep stock by location."}
        />
      </div>
      <InventoryNav tracked={settings.mode === "tracked"} />
      <div className="pt-6">{children}</div>
    </div>
  );
}
