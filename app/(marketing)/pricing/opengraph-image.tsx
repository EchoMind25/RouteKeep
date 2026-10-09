import { ogCard, OG_SIZE } from "@/components/marketing/og-card";

export const alt = "Pest control software pricing, posted.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return ogCard("Pest control software pricing, posted.", "$79, $179 or $349 a month. Unlimited users. No contract.");
}
