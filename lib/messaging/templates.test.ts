import { describe, expect, it } from "vitest";
import { renderEmail, type EmailInput } from "./templates";

const input: EmailInput = {
  business: { name: "Timpanogos Pest & Lawn", licenseNo: "UT-BUS-4471", address: "1800 N Main St, Orem, UT 84057", phone: "(801) 555-0100", whiteLabel: false },
  greeting: "Marisol",
  unsubscribeUrl: "https://app.example/u/abc.def",
  portalUrl: "https://app.example/p/t1",
};

describe("renderEmail (FR-MSG-01, CR-03, FR-MSG-04, FR-BRD-03)", () => {
  it("names the business and license, links unsubscribe, credits the product", () => {
    const e = renderEmail({ topic: "appointment.completed", serviceType: "General pest", dateText: "on Tuesday, October 6", technicianName: "Anika Sorensen", recordUrl: "https://app.example/p/t1/records/a1" }, input);
    expect(e.subject).toBe("Service complete: General pest, on Tuesday, October 6");
    expect(e.text).toContain("Anika Sorensen finished your general pest on Tuesday, October 6.");
    expect(e.text).toContain("Timpanogos Pest & Lawn, pesticide business license UT-BUS-4471");
    expect(e.text).toContain("Stop these emails: https://app.example/u/abc.def");
    expect(e.text).toContain("Sent with RouteKeep");
    expect(e.html).toContain("Timpanogos Pest &amp; Lawn");
    expect(e.html).toContain('href="https://app.example/u/abc.def"');
    expect(e.html).not.toMatch(/<img|https?:\/\/(?!app\.example)/);
  });

  it("drops the product credit for white label and the unsubscribe link on a sign-in email", () => {
    const e = renderEmail({ topic: "portal.sign_in", link: "https://app.example/p/t1/auth?token=x" }, { ...input, business: { ...input.business, whiteLabel: true } });
    expect(e.text).not.toContain("RouteKeep");
    expect(e.text).not.toContain("Stop these emails");
    expect(e.text).toContain("Sign in: https://app.example/p/t1/auth?token=x");
  });

  it("never uses an em dash", () => {
    for (const data of [
      { topic: "appointment.reminder" as const, serviceType: "Lawn", dateText: "tomorrow", windowText: "8:00 AM and 12:00 PM" },
      { topic: "invoice.issued" as const, number: 1042, totalText: "$129.00", dueText: "on receipt", invoiceUrl: "https://app.example/i" },
      { topic: "appointment.on_the_way" as const, serviceType: "General pest", technicianName: "Rowan" },
      { topic: "payment.received" as const, amountText: "$69.00", methodText: "cash", invoiceNumber: 12, balanceText: "$0.00", receiptUrl: "https://app.example/p" },
      { topic: "customer.switch_notice" as const, message: null },
    ]) {
      const e = renderEmail(data, input);
      expect(e.text + e.subject + e.html).not.toContain("—");
    }
  });

  it("words the new notices plainly", () => {
    expect(renderEmail({ topic: "appointment.on_the_way", serviceType: "General pest", technicianName: "Rowan" }, input).subject).toBe("Rowan is on the way");
    const r = renderEmail({ topic: "payment.received", amountText: "$69.00", methodText: "check #1042", invoiceNumber: 12, balanceText: "$0.00", receiptUrl: "https://app.example/p" }, input);
    expect(r.text).toContain("We received $69.00 by check #1042 for invoice 12.");
    const n = renderEmail({ topic: "customer.switch_notice", message: "We moved to a new system." }, input);
    expect(n.text).toContain("We moved to a new system.");
    expect(n.text).toContain("Open your account: https://app.example/p/t1");
  });
});
