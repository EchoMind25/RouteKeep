import { describe, expect, it } from "vitest";
import { orderEmailBody, orderMailto } from "./order-email";

// FR-INV-05
const base = {
  businessName: "Green & Co",
  vendorName: "Acme Supply",
  vendorEmail: "orders@acme.test",
  accountNo: "A-77",
  orderNumber: 12,
  notes: null,
  lines: [
    { productName: "Talstar P", sku: "TP-1", packages: 2, packageLabel: "1 gal jug" },
    { productName: "Gel bait", sku: null, packages: 10, packageLabel: "30 g tube" },
  ],
};

describe("orderMailto", () => {
  it("fills the address, subject and every line", () => {
    const url = orderMailto(base);
    expect(url.startsWith("mailto:orders@acme.test?subject=")).toBe(true);
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("subject")).toBe("Order 12 from Green & Co");
    const body = params.get("body")!;
    expect(body).toContain("- 2 x 1 gal jug: Talstar P (item TP-1)");
    expect(body).toContain("- 10 x 30 g tube: Gel bait");
    expect(body).toContain("Account number: A-77");
    expect(body.trimEnd().endsWith("Green & Co")).toBe(true);
  });

  it("works without a vendor email and encodes reserved characters", () => {
    const url = orderMailto({ ...base, vendorEmail: null });
    expect(url.startsWith("mailto:?subject=")).toBe(true);
    expect(url).not.toContain("&co");
  });

  it("includes notes and leaves out a missing account", () => {
    const body = orderEmailBody({ ...base, accountNo: null, notes: " Deliver to the shop. " });
    expect(body).toContain("Deliver to the shop.");
    expect(body).not.toContain("Account number");
  });
});
