import tokens from "@/replica/design/tokens.json";
import { BRAND } from "@/lib/brand";

// FR-MSG-01: the emails a business sends its customers. Every one carries the
// business's name, license and address (CR-03, CR-08), an unsubscribe link
// except the sign-in link the customer just asked for (FR-MSG-04), and a small
// product credit unless the business bought white label (FR-BRD-03). Plain
// text first; the HTML is the same words with light formatting, colours from
// the design tokens. No tracking pixels, no remote images.

export type Topic = "appointment.reminder" | "appointment.on_the_way" | "appointment.completed" | "invoice.issued" | "payment.received" | "portal.sign_in" | "customer.switch_notice";

export interface EmailBusiness {
  name: string;
  licenseNo: string;
  address: string;
  phone: string | null;
  whiteLabel: boolean;
}

export interface EmailInput {
  business: EmailBusiness;
  /** First name for a person, the full name for a business. */
  greeting: string;
  unsubscribeUrl: string | null;
  portalUrl: string;
}

export type TopicData =
  | { topic: "appointment.reminder"; serviceType: string; dateText: string; windowText: string | null }
  | { topic: "appointment.on_the_way"; serviceType: string; technicianName: string | null }
  | { topic: "payment.received"; amountText: string; methodText: string; invoiceNumber: number | null; balanceText: string; receiptUrl: string }
  | { topic: "customer.switch_notice"; message: string | null }
  | { topic: "appointment.completed"; serviceType: string; dateText: string; technicianName: string | null; recordUrl: string }
  | { topic: "invoice.issued"; number: number; totalText: string; dueText: string; invoiceUrl: string }
  | { topic: "portal.sign_in"; link: string };

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const c = tokens.color.light;

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

interface Body {
  subject: string;
  lines: string[];
  action?: { label: string; url: string };
  after?: string[];
}

function body(data: TopicData, input: EmailInput): Body {
  const b = input.business.name;
  switch (data.topic) {
    case "appointment.reminder":
      return {
        subject: `Reminder: ${data.serviceType} ${data.dateText}`,
        lines: [
          `Hi ${input.greeting},`,
          `${b} is scheduled for ${data.serviceType.toLowerCase()} ${data.dateText}${data.windowText ? `, arriving between ${data.windowText}` : ""}.`,
          "Please leave gates unlocked and keep pets inside if you can. If the time doesn't work, call or reply and we'll move it.",
        ],
        action: { label: "See your visit", url: input.portalUrl },
      };
    case "appointment.on_the_way":
      return {
        subject: `${data.technicianName ?? "Your technician"} is on the way`,
        lines: [
          `Hi ${input.greeting},`,
          `${data.technicianName ?? "Your technician"} from ${b} is heading to you now for your ${data.serviceType.toLowerCase()}.`,
          "If you can, unlock gates and keep pets inside. No need to be home unless we asked.",
        ],
      };
    case "payment.received":
      return {
        subject: `Receipt: ${data.amountText} paid to ${b}`,
        lines: [
          `Hi ${input.greeting},`,
          `Thanks. We received ${data.amountText} by ${data.methodText}${data.invoiceNumber ? ` for invoice ${data.invoiceNumber}` : ""}.`,
          `Your balance is now ${data.balanceText}.`,
        ],
        action: { label: "See your account", url: data.receiptUrl },
      };
    case "customer.switch_notice":
      return {
        subject: `Your ${b} account has a new home`,
        lines: [
          `Hi ${input.greeting},`,
          ...(data.message ? [data.message] : [`${b} now keeps your visits, service records and invoices in one place you can check any time. Same service, same people.`]),
          "Sign in with your email address. We send you a link each time; there's no password to remember.",
        ],
        action: { label: "Open your account", url: input.portalUrl },
      };
    case "appointment.completed":
      return {
        subject: `Service complete: ${data.serviceType}, ${data.dateText}`,
        lines: [
          `Hi ${input.greeting},`,
          `${data.technicianName ? `${data.technicianName} finished` : "We finished"} your ${data.serviceType.toLowerCase()} ${data.dateText}. Your service record lists every product applied, where and how much.`,
        ],
        action: { label: "View your service record", url: data.recordUrl },
        after: ["Keep pets and kids off treated areas until they're dry."],
      };
    case "invoice.issued":
      return {
        subject: `Invoice ${data.number} from ${b}: ${data.totalText}`,
        lines: [`Hi ${input.greeting},`, `Here's invoice ${data.number} for ${data.totalText}, due ${data.dueText}.`],
        action: { label: "View invoice", url: data.invoiceUrl },
        after: ["Questions about it? Reply to this email or give us a call."],
      };
    case "portal.sign_in":
      return {
        subject: `Your sign-in link for ${b}`,
        lines: [`Hi ${input.greeting},`, `Here's your link to sign in to your ${b} account. It works once, for the next 20 minutes.`],
        action: { label: "Sign in", url: data.link },
        after: ["Didn't ask for this? Ignore it. Nobody can sign in without the link."],
      };
  }
}

export function renderEmail(data: TopicData, input: EmailInput): RenderedEmail {
  const { subject, lines, action, after = [] } = body(data, input);
  const biz = input.business;
  const footer = [
    `${biz.name}, pesticide business license ${biz.licenseNo}`,
    [biz.address, biz.phone].filter(Boolean).join(", "),
    ...(input.unsubscribeUrl && data.topic !== "portal.sign_in" ? [`Stop these emails: ${input.unsubscribeUrl}`] : []),
    ...(biz.whiteLabel ? [] : [`Sent with ${BRAND.name}`]),
  ].filter(Boolean);

  const text = [...lines, ...(action ? [`${action.label}: ${action.url}`] : []), ...after, "", "--", ...footer].join("\n\n").replace(/\n\n--\n\n/, "\n\n--\n");

  const p = (s: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${c.fg}">${escape(s)}</p>`;
  const button = action
    ? `<p style="margin:24px 0"><a href="${escape(action.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${c.accent};color:${c["on-accent"]};font-weight:600;font-size:16px;text-decoration:none">${escape(action.label)}</a></p>`
    : "";
  const foot = footer
    .map((f) =>
      f.startsWith("Stop these emails: ")
        ? `<a href="${escape(input.unsubscribeUrl!)}" style="color:${c["fg-muted"]}">Stop these emails</a>`
        : escape(f),
    )
    .join("<br>");
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:${c.canvas}">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<p style="margin:0 0 24px;font-size:18px;font-weight:700;color:${c.fg}">${escape(biz.name)}</p>
${lines.map(p).join("\n")}
${button}
${after.map(p).join("\n")}
<p style="margin:32px 0 0;padding-top:16px;border-top:1px solid ${c.line};font-size:13px;line-height:20px;color:${c["fg-muted"]}">${foot}</p>
</div></body></html>`;
  return { subject, text, html };
}
