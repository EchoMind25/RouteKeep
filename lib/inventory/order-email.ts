import { formatNumber } from "@/lib/domain/units";

// FR-INV-05: the text of a purchase order as an email the owner sends from their
// own mail app. RouteVerde never contacts a vendor; this only builds a link.
// Product lines and the business's own name only, never customer data (docs/INVENTORY.md "Privacy").

export interface OrderEmailInput {
  businessName: string;
  vendorName: string;
  vendorEmail: string | null;
  accountNo: string | null;
  orderNumber: number | null;
  notes: string | null;
  lines: { productName: string; sku: string | null; packages: number; packageLabel: string }[];
}

export function orderEmailSubject(i: Pick<OrderEmailInput, "businessName" | "orderNumber">): string {
  return `Order${i.orderNumber ? ` ${i.orderNumber}` : ""} from ${i.businessName}`;
}

export function orderEmailBody(i: OrderEmailInput): string {
  const lines = i.lines.map((l) => `- ${formatNumber(l.packages)} x ${l.packageLabel}: ${l.productName}${l.sku ? ` (item ${l.sku})` : ""}`);
  return [
    `Hello ${i.vendorName},`,
    "",
    "Please supply the following:",
    "",
    ...lines,
    ...(i.notes?.trim() ? ["", i.notes.trim()] : []),
    ...(i.accountNo ? ["", `Account number: ${i.accountNo}`] : []),
    "",
    "Thank you,",
    i.businessName,
  ].join("\r\n");
}

/** A mailto: link with the subject and body filled in. Browsers cap very long links, so the order page also offers print. */
export function orderMailto(i: OrderEmailInput): string {
  const to = i.vendorEmail?.trim() ? encodeURIComponent(i.vendorEmail.trim()).replaceAll("%40", "@") : "";
  return `mailto:${to}?subject=${encodeURIComponent(orderEmailSubject(i))}&body=${encodeURIComponent(orderEmailBody(i))}`;
}
