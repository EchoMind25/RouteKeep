import { BrandMark } from "@/components/brand-mark";
import { ErrorReporter } from "@/components/telemetry/error-reporter";
import { getUserSession } from "@/lib/auth/session";
import { memberDataSharing } from "@/lib/telemetry/sharing";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // OPS-04: signed out, error reports are anonymous (surface public). A user
  // who already belongs to a business follows that business's setting.
  const user = await getUserSession();
  const reportErrors = !user?.claims.tenant_id || (await memberDataSharing(user.claims)) !== "none";
  return (
    <div className="min-h-dvh px-4 py-8 sm:px-8">
      <div className="mx-auto grid w-full max-w-xl gap-10">
        <BrandMark />
        <main>{children}</main>
        {reportErrors ? <ErrorReporter /> : null}
      </div>
    </div>
  );
}
