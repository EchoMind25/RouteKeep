import { ogCard, OG_SIZE } from "@/components/marketing/og-card";

export const alt = "Utah pesticide application records.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return ogCard("Utah pesticide application records.", "Every field R68-7 asks for, in plain words.");
}
