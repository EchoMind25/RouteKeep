import { ogCard, OG_SIZE } from "@/components/marketing/og-card";

export const alt = "Switch software without losing a customer.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return ogCard("Switch software without losing a customer.", "Import your own export, check every row, undo for 7 days.");
}
