import { BRAND } from "@/lib/brand";

// Copy for the public landing page, in one place so the FAQ on the page and the
// FAQ in the structured data never drift apart. Prices come from PRD D-11; the
// white label offer from PRD D-14. Nothing here is a made-up number or review.

export const PLANS = [
  {
    name: "Starter",
    cents: 7900,
    limit: "Up to 300 active customers",
    note: "One or two trucks finding their rhythm.",
  },
  {
    name: "Pro",
    cents: 17900,
    limit: "Up to 1,500 active customers",
    note: "Where most 3 to 6 truck shops land.",
    featured: true,
  },
  {
    name: "Growth",
    cents: 34900,
    limit: "Up to 5,000 active customers",
    note: "Full routes, full season, bigger office.",
  },
] as const;

export const WHITE_LABEL = {
  cents: 500000,
  renewalCents: 50000,
  includes: [
    "Your logo, colors and company name on the office app, the tech app, the customer portal and every document, with our name taken off",
    "Set up your way: your services, plans, forms and reports shaped around how your shop already runs",
    "Setup done with you, start to finish: products, techs and your customer list brought over from your old software",
    "Honest advice on the phones, tablets and gear your techs carry, and what's worth keeping up",
    "Your own web address once you own one",
    "A full year of support, setup included. Something breaks or you're stuck, we fix it",
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
    a: "Yes. Pick a tech, hit optimize, and you see the new order and the drive time saved before anything changes. Keep it or undo it. Arrival windows are respected, and a stop that's suddenly a long drive away gets flagged before you publish, because that's usually a bad map pin. There's also an AI plan that reads your access notes, like \"not before 2\" or \"dog out until noon\", and tells you why it moved each stop. It only sees the stops and notes, never your customers' names or addresses.",
  },
  {
    q: "Can my techs sell plans and earn commission?",
    a: "If you turn it on. Techs add the customer and plan from their phone and see what the sale pays before they save. You set the rule (a flat amount, a percent of the first service, or both) and approve or pay it from the office.",
  },
  {
    q: "What about billing, autopay and text reminders?",
    a: "Invoicing, email reminders, card payments and autopay are in. Finished visits turn into invoices, customers pay online or on autopay through your own Stripe account, and late ones land on a collections list. Text reminders come next. Card and bank numbers only ever go into Stripe's own secure pages, never through us.",
  },
  {
    q: "Will my invoices show my logo?",
    a: "Yes, on every plan. Invoices carry your logo and business details and nothing of ours. Service records and other customer messages show your name and license with a small Powered by note, unless you go white label.",
  },
  {
    q: "What does the $5,000 white label package include?",
    a: "Your brand on everything your office, techs and customers see, with our name removed everywhere. We set it up around how you work, move your customer list over, help you pick the right gear for your techs, and support you for a full year. After that year, support is $500 a year if you want to keep it. We build it so you shouldn't need much. Your regular monthly plan still applies.",
  },
  {
    q: "Who sees my customer data?",
    a: "You and your team. We don't sell it or share it. Street addresses go to a mapping service so pins land in the right place, and that's it.",
  },
];
