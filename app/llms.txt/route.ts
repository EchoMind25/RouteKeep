import { BRAND } from "@/lib/brand";
import { formatCents } from "@/lib/domain/money";
import { FAQS, PLANS, WHITE_LABEL } from "@/lib/landing/content";
import { publicEnv } from "@/lib/public-env";

// /llms.txt: a plain summary for AI assistants and answer engines, written from
// the same content as the landing page so the two always agree.
export const dynamic = "force-static";

export function GET() {
  const url = publicEnv.siteUrl;
  const body = [
    `# ${BRAND.name}`,
    "",
    `> Pest control and lawn care software for companies running 1 to 10 trucks: scheduling, route optimization, an offline technician app, and pesticide application records. Month to month, no contract, no setup fee.`,
    "",
    "## Pricing",
    ...PLANS.map((p) => `- ${p.name}: ${formatCents(p.cents)} a month, ${p.limit.toLowerCase()}. Unlimited users.`),
    `- White label: ${formatCents(WHITE_LABEL.cents)} one time, then the regular monthly plan; after the first year, support is ${formatCents(WHITE_LABEL.renewalCents)} a year if wanted. Includes: ${WHITE_LABEL.includes.join("; ")}.`,
    "",
    "## Questions and answers",
    ...FAQS.flatMap((f) => [`### ${f.q}`, f.a, ""]),
    "## Links",
    `- [Home](${url}/)`,
    `- [Pricing](${url}/#pricing)`,
    `- [White label](${url}/#white-label)`,
    `- [Sign in or get started](${url}/sign-in)`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
