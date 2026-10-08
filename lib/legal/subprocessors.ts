// CR-13, NFR-08: the services that touch customer data, kept in step with
// docs/VENDORS.md. "When used" ones are off unless the business turns the
// feature on or the platform connects the account.

export const SUBPROCESSORS = [
  { name: "Supabase", purpose: "Database, sign-in and file storage", data: "All business data", where: "United States", when: "Always" },
  { name: "Netlify", purpose: "Hosting the app", data: "Request logs (IP address, pages requested)", where: "United States and global edge", when: "Always" },
  { name: "Inngest", purpose: "Scheduled background jobs", data: "Job ids, no customer details", where: "United States", when: "Always" },
  { name: "Resend", purpose: "Sending email", data: "Recipient email, message content", where: "United States", when: "When email is on" },
  { name: "Google Maps Platform", purpose: "Finding addresses on the map", data: "Street addresses only. No names, phone numbers or notes", where: "United States", when: "When address lookup is on" },
  { name: "OpenFreeMap", purpose: "Street map tiles", data: "The viewer's IP address and the map area viewed", where: "European Union", when: "When the street map is on" },
  { name: "Anthropic", purpose: "AI route plans", data: "Stop numbers, service types, time windows, distances and notes with numbers, phone numbers and emails removed. No names or addresses", where: "United States", when: "When someone asks for an AI plan" },
  { name: "Stripe", purpose: "Card and bank payments", data: "Payment details entered in Stripe's own form; customer name and email for receipts", where: "United States", when: "When payments are connected" },
] as const;
