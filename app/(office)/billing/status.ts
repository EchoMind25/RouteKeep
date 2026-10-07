export const INVOICE_STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  open: { label: "Open", tone: "accent" },
  paid: { label: "Paid", tone: "success" },
  void: { label: "Void", tone: "neutral" },
  uncollectible: { label: "Written off", tone: "danger" },
};
