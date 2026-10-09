// ENG-10: an in-app entry for every release. Newest first. Written for the
// people using the product: what they can do now, not how it was built.

export interface ChangelogEntry {
  date: string;
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-10-09",
    title: "Two-step sign-in for owners and admins",
    items: [
      "Owners and admins now enter a 6-digit code from an authenticator app after the emailed code. You set it up the first time you sign in.",
      "Add a second phone or remove one at Settings, Team, Two-step sign-in. If you lose your only phone, contact support.",
      "Office staff and technicians sign in as before.",
    ],
  },
  {
    date: "2026-10-09",
    title: "Card payments and autopay",
    items: [
      "Connect your own Stripe account in Settings, Payments. Money goes straight to your bank; Stripe sets the fee and RouteVerde adds nothing.",
      "Customers can pay an invoice from their account page, and turn on autopay with a card or bank account. Card and bank numbers are only typed into Stripe's own pages.",
      "Autopay pays each new invoice when it's issued. If a payment fails, the customer gets an email and it's tried again 3 days later, then 4 days after that.",
      "Refund a card or bank payment from the invoice. Each night your payments are checked against Stripe, and anything that needs you shows in Settings, Payments.",
    ],
  },
  {
    date: "2026-10-08",
    title: "Ready for your first switch-over",
    items: [
      "Get set up now has a switch-over checklist: customers in, technicians invited, first route planned, email on, go live.",
      "White label businesses see their own name, logo and colour in the office app, the tech app and their customers' accounts. Pick the colour in Settings; it is adjusted where needed so text stays readable.",
      "Terms, Privacy, a data processing addendum and the list of services that handle data are public, and there is a status page.",
    ],
  },
  {
    date: "2026-10-08",
    title: "Customer accounts and email",
    items: [
      "Customers get an email the day before a visit, a service complete email with their record, and their invoices. Each has your name, license and an unsubscribe link.",
      "Customers can sign in to their own account with a link sent to their email. They see their next visit, every service record, their invoices, and can ask for service.",
      "Requests they send show up on the Customers page and on their customer page.",
      "Settings, Messages shows every message sent or held back, and why. Imported customers get nothing until you press Go live.",
      "On a customer page, Email a sign-in link sends them their link.",
    ],
  },
  {
    date: "2026-10-08",
    title: "Import your customer list, export everything",
    items: [
      "Settings, Import: upload a CSV from your old software or a spreadsheet. Columns are matched for you; change any match before anything happens.",
      "Every row is checked first. You see how many customers, plans and open balances will come over, and you can download only the rows that need fixing, with the reason on each.",
      "Import brings over customers, service addresses, plans with their next service date and upcoming visits, and what each customer owes. The same file twice adds nothing.",
      "Changed your mind? Undo an import for 7 days. Customers you have already worked with are kept.",
      "Settings, Export: one ZIP with all your data, your customer list ready to import anywhere, every application record as a PDF per month, and all photos and signatures.",
    ],
  },
  {
    date: "2026-10-07",
    title: "AI plan for routes",
    items: [
      'Next to Optimize on each route there\'s now AI plan. It reads the access and visit notes ("not before 2", "dog out until noon") and plans around them.',
      "It shows the same preview as Optimize, plus a short summary and the reason for each stop it moved. Nothing changes until you save.",
      "Every plan is checked against the built-in optimizer: if the AI's order would be late or much longer, you get the built-in order instead, with the reason.",
      "The AI never sees customer names, addresses, phone numbers or gate codes.",
    ],
  },
  {
    date: "2026-10-07",
    title: "Billing: invoices, payments and money reports",
    items: [
      "Billing in the main menu. Invoice finished visits turns every finished visit into an invoice, or one invoice per month, quarter or year for plans billed that way. Running it twice never bills anything twice.",
      "Cash a technician took at the door is applied to that visit's invoice on its own.",
      "Record cash, check or other payments, give a credit with a reason, or void an invoice made in error. Every one is kept in the invoice's history.",
      "Collections lists what is late, oldest first. Reports, Money shows revenue by month, money owed by age and production by technician.",
      "Upload your logo in Settings. Invoices show your logo, name and license and nothing of ours.",
      "Customer pages show their invoices and what they owe.",
      "Fixed: after a form showed an error, a radio choice such as Check could quietly switch back to the first option.",
    ],
  },
  {
    date: "2026-10-07",
    title: "Technicians can add customers, with commission",
    items: [
      "Turn it on in Settings, Sales, and set what a sale earns: a flat amount, a percent of the first service, or both.",
      "Technicians tap New customer in their app to add a customer and sell a plan on the spot. The sale is credited to them and they see the commission before saving.",
      "Approve, mark paid or void commissions in Reports, Commissions, and download them as CSV for payroll. Amounts never change after the sale.",
      "The office can credit a technician when entering a sale they phoned in.",
    ],
  },
  {
    date: "2026-10-07",
    title: "Correcting a record",
    items: [
      "Amend a product record from the visit page: change what was applied, how much, where on the property and when, and say why.",
      "The original stays on file under Earlier versions, and every amendment is logged with who made it.",
      "The customer's PDF, the product usage report and the technician app all use the corrected version.",
      "Fixed: after a form showed an error, a dropdown could jump back to its first choice instead of keeping yours.",
    ],
  },
  {
    date: "2026-10-07",
    title: "Reports: product usage",
    items: [
      "Reports in the main menu, starting with product usage: what was applied, how much and where, for any range up to a year.",
      "Narrow it to one product or one technician. Totals are listed per product and EPA number.",
      "Download every record as CSV, with all the fields a state inspector asks for, or as a PDF with your business name and license on each page.",
      "An amended record counts once, as amended.",
      "Service record PDFs now show your business name, license and page numbers at the foot of every page.",
    ],
  },
  {
    date: "2026-10-07",
    title: "Technician app that works offline",
    items: [
      "Technicians install the app from the browser and open it straight to today's route. It works with no signal at all.",
      "Each stop walks through arrive, checklist, products, photos, signature, payment and complete, and is saved on the phone as it is typed.",
      "Products remember what was used at the property last time and read the mix back in plain words, so a decimal is never misread.",
      "A stop cannot be completed while a required record field is missing; the app names the field.",
      "Work done offline uploads by itself when the phone reconnects. If the office changed a stop in the meantime, the work is kept and flagged for review.",
      "Flagged visits appear on the schedule. Mark each one as it happened in the field, or keep the office's change; the product records stay either way.",
      "Outdoor mode for bright sun, in the app's settings.",
      "Records are due within 24 hours of the application: the app warns 4 hours before and marks a stop overdue after that, and the schedule lists visits started over 20 hours ago that have no record yet.",
    ],
  },
  {
    date: "2026-10-07",
    title: "Dispatch board",
    items: [
      "The schedule shows each technician's route beside a map. Pick a stop in either place to find it in the other.",
      "Drag stops to reorder a route, hand them to another technician, or drop them on another day. The keyboard works too: Space to pick up, arrows to move, Space to drop.",
      "Undated, skipped and unassigned visits wait in Needs attention beside the map; drag them onto a route.",
      "Optimize shows the new order and the drive time saved before anything changes. Undo puts the old order back.",
      "Publishing warns about any stop reached by an unusually long drive, which is usually a wrong pin.",
      "Check pin: drag a property's pin onto the building and lock it so address changes and imports never move it.",
    ],
  },
  {
    date: "2026-10-06",
    title: "Customers, plans and the schedule",
    items: [
      "Create your business, invite your team and add technicians, plans and products.",
      "Add customers with their properties, sell a plan, and see 60 days of visits scheduled automatically.",
      "Change one visit or all future ones; skip, pause, cancel and restore with a reason on record.",
    ],
  },
];
