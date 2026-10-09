import { ErrorReporter } from "@/components/telemetry/error-reporter";
import { getMemberSession } from "@/lib/auth/session";
import { memberDataSharing } from "@/lib/telemetry/sharing";

// OPS-03, OPS-04: the technician app and sales pages load the browser error
// reporter only when the business shares product data. The pages themselves
// still decide who may see them (requireMember).
export default async function TechGroupLayout({ children }: { children: React.ReactNode }) {
  const member = await getMemberSession();
  const reportErrors = member ? (await memberDataSharing(member.claims)) !== "none" : false;
  return (
    <>
      {children}
      {reportErrors ? <ErrorReporter /> : null}
    </>
  );
}
