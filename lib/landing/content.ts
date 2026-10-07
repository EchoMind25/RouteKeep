import { BRAND } from "@/lib/brand";

// Copy for the public landing page, in one place so the FAQ on the page and the
// FAQ in the structured data never drift apart. Prices come from PRD D-11; the
// white label offer from PRD D-14. Nothing here is a made-up number or review.

export const PLANS = [
  { name: "Starter", cents: 7900, limit: "Up to 300 active customers", note: "One or two trucks finding their rhythm." },
  { name: "Pro", cents: 17900, limit: "Up to 1,500 active customers", note: "Where most 3 to 6 truck shops land.", featured: true },
  { name: "Growth", cents: 34900, limit: "Up to 5,000 active customers", note: "Full routes, full season, bigger office." },
] as const;

export const WHITE_LABEL = {
  cents: 200000,
  includes: [
    "Your logo, colors and company name on the office app, the tech app, every PDF and every statement",
    "Your own web address once you own one",
    "Setup done with you: plans, products, techs and your customer list brought over",
    "A walkthrough for you and your office, on a call or in person",
    "A full year of fix-it support. Something breaks, we fix it",
  ],
} as const;

export interface Faq {
  q: string;
  a: string;
}

export const FAQS: Faq[] = [
  {
    q: `What is ${BRAND.name}?`,
    a: `${BRAND.name} is pest control and lawn care software for companies running 1 to 10 trucks. Scheduling, route optimization, a technician app that works with no cell service, and pesticide application records, priced month to month.`,
  },
  {
    q: "Does the technician app work without cell service?",
    a: "Yes. The whole day lives on the phone. Techs can finish every stop with zero bars, and everything uploads once by itself when signal comes back. We test it by killing the app in the middle of a stop. Nothing gets lost.",
  },
  {
    q: "Does it keep pesticide application records for Utah?",
    a: "It asks for every field Utah's rule lists (customer, address, area treated, target pests, product, EPA number, mix rate, total applied, applicator license and more) and won't let a tech close the stop with one missing. Restricted use products prompt for the customer's written statement. Check your own state's rule with your department of agriculture.",
  },
  {
    q: "How much does pest control software cost?",
    a: "Ours is $79, $179 or $349 a month depending on how many active customers you have. Unlimited users. No contract, no setup fee, cancel any month.",
  },
  {
    q: "Can I switch from FieldRoutes, PestPac, GorillaDesk or Jobber?",
    a: "Yes. Export your customer list from the software you use now and we'll bring it over for you. You don't need a login to your old system shared with us, just the file you export.",
  },
  {
    q: "Does it optimize routes?",
    a: "Yes. Pick a tech, hit optimize, and you see the new order and the drive time saved before anything changes. Keep it or undo it. Arrival windows are respected, and a stop that's suddenly a long drive away gets flagged before you publish, because that's usually a bad map pin.",
  },
  {
    q: "Can my techs sell plans and earn commission?",
    a: "If you turn it on. Techs add the customer and plan from their phone and see what the sale pays before they save. You set the rule (a flat amount, a percent of the first service, or both) and approve or pay it from the office.",
  },
  {
    q: "What about billing, autopay and text reminders?",
    a: "Being built now. Invoices and autopay come first through Stripe, then email and text reminders. Card numbers will only ever go through Stripe's own secure form, never through us.",
  },
  {
    q: "What does the $2,000 white label package include?",
    a: "Your brand on everything your office, techs and customers see, set up with you, your customer list moved over, and a full year of fix-it support. It's a one time fee. Your regular monthly plan still applies after that.",
  },
  {
    q: "Who sees my customer data?",
    a: "You and your team. We don't sell it or share it. Street addresses go to a mapping service so pins land in the right place, and that's it.",
  },
];
