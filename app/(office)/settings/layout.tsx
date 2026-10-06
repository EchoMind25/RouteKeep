import { PageHeader } from "@/components/ui/layout";
import { SettingsNav } from "./settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <PageHeader title="Settings" />
      <SettingsNav />
      <div className="pt-6">{children}</div>
    </div>
  );
}
