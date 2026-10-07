import { redirect } from "next/navigation";
import { getMemberSession, getUserSession } from "@/lib/auth/session";

// /app sends each person to where their work starts. The public landing page
// lives at /, so search engines and visitors see the product first.
export default async function Home() {
  const user = await getUserSession();
  if (!user) redirect("/sign-in");
  const member = await getMemberSession();
  if (!member) redirect("/onboarding");
  redirect(member.role === "technician" ? "/tech" : "/schedule");
}
