import { redirect } from "next/navigation";
import { MFA_PATH } from "@/lib/auth/mfa";
import { getMemberSession, getMfaStep, getUserSession, isDeveloperUser } from "@/lib/auth/session";

// /app sends each person to where their work starts. The public landing page
// lives at /, so search engines and visitors see the product first.
export default async function Home() {
  const user = await getUserSession();
  if (!user) redirect("/sign-in");
  const step = await getMfaStep();
  if (step !== "allow") redirect(MFA_PATH[step]);
  const member = await getMemberSession();
  // OPS-01: a developer who belongs to no business goes to the console, which checks the second factor itself.
  if (!member) redirect((await isDeveloperUser()) ? "/developer" : "/onboarding");
  redirect(member.role === "technician" ? "/tech" : "/schedule");
}
