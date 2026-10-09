import { redirect } from "next/navigation";
import { MFA_PATH } from "@/lib/auth/mfa";
import { getMemberSession, getMfaStep, getUserSession } from "@/lib/auth/session";

// /app sends each person to where their work starts. The public landing page
// lives at /, so search engines and visitors see the product first.
export default async function Home() {
  const user = await getUserSession();
  if (!user) redirect("/sign-in");
  const step = await getMfaStep();
  if (step !== "allow") redirect(MFA_PATH[step]);
  const member = await getMemberSession();
  if (!member) redirect("/onboarding");
  redirect(member.role === "technician" ? "/tech" : "/schedule");
}
