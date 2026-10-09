import { ogCard, OG_SIZE } from "@/components/marketing/og-card";

export const alt = "Your customer list stays yours.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return ogCard("Your customer list stays yours.", "Walled off per business. Export everything, any day.");
}
