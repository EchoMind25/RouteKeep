import { CheckCircle, Circle } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { setupProgress } from "@/lib/server/catalog";

export const metadata: Metadata = { title: "Get set up" };

export default async function SetupPage() {
  const member = await requireMember(OFFICE_ROLES);
  const p = await setupProgress(member);

  // S03 / FR-SET accept: a usable empty schedule in under 10 minutes.
  const steps = [
    { done: true, title: "Create your business", body: "Name, license number, address and time zone.", href: "/settings", cta: "Review" },
    { done: p.technicians > 0, title: "Add your technicians", body: "Each needs an applicator license number and expiry; both print on every record.", href: "/settings/technicians", cta: "Add technicians" },
    { done: p.plans > 0, title: "Set up service plans", body: "Price, initial visit price and how often you come back.", href: "/settings/plans", cta: "Create a plan" },
    { done: p.products > 0, title: "Add the products you apply", body: "EPA registration number, signal word and default mix rate.", href: "/settings/products", cta: "Add products" },
    { done: p.customers > 0, title: "Add your first customer", body: "Customer, property and plan on one screen. Their first visits land on the schedule.", href: "/customers/new", cta: "Add a customer" },
  ];
  const remaining = steps.filter((s) => !s.done).length;
  // FR-MIG-17: the switch-over checklist, once there is something to switch.
  const cutover = [
    { done: p.imported > 0 || p.customers > 0, title: "Bring your customers over", body: "Import the list from your old software, or add customers as you go.", href: "/settings/import", cta: "Import" },
    { done: p.techLogins > 0, title: "Invite your technicians", body: "Each signs in on their phone and installs the tech app.", href: "/settings/team", cta: "Invite" },
    { done: p.optimized > 0, title: "Plan your first route", body: "Open a day, check pins, optimize, publish.", href: "/schedule", cta: "Open schedule" },
    { done: p.emailOn, title: "Turn on email", body: "Reminders, service complete notices and invoices.", href: "/settings/messages", cta: "Check" },
    { done: p.stripeConnected, title: "Connect card payments", body: "Coming next: autopay and card payments through Stripe.", href: "/settings/messages", cta: "Not yet", disabled: true },
    { done: p.live, title: "Go live", body: "Imported customers start getting messages. Do this once you stop using the old system.", href: "/settings/messages", cta: "Go live" },
  ];

  return (
    <div className="grid gap-2">
      <PageHeader
        title="Get set up"
        description={remaining === 0 ? "Everything is in place. Your schedule fills as you add customers." : `${remaining} of ${steps.length} steps left. Each takes a minute or two.`}
        actions={
          <Button asChild variant="secondary">
            <Link href="/schedule">Go to schedule</Link>
          </Button>
        }
      />
      <ol className="grid max-w-3xl divide-y divide-line rounded-panel border border-line bg-surface">
        {steps.map((s) => (
          <li key={s.title} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <span className={cn("mt-0.5", s.done ? "text-success" : "text-fg-muted")} aria-hidden>
                {s.done ? <CheckCircle size={22} weight="fill" /> : <Circle size={22} />}
              </span>
              <div className="grid gap-0.5">
                <p className="font-semibold">
                  {s.title}
                  <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                </p>
                <p className="text-sm text-fg-muted">{s.body}</p>
              </div>
            </div>
            <Button asChild variant={s.done ? "ghost" : "secondary"} size="sm" className="self-start sm:self-center">
              <Link href={s.href}>{s.done && s.cta !== "Review" ? "Manage" : s.cta}</Link>
            </Button>
          </li>
        ))}
      </ol>
      <h2 className="pt-8 text-lg font-semibold">Before you switch over</h2>
      <ol className="grid max-w-3xl divide-y divide-line rounded-panel border border-line bg-surface" aria-label="Switch-over checklist">
        {cutover.map((s) => (
          <li key={s.title} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <span className={cn("mt-0.5", s.done ? "text-success" : "text-fg-muted")} aria-hidden>
                {s.done ? <CheckCircle size={22} weight="fill" /> : <Circle size={22} />}
              </span>
              <div className="grid gap-0.5">
                <p className="font-semibold">
                  {s.title}
                  <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                </p>
                <p className="text-sm text-fg-muted">{s.body}</p>
              </div>
            </div>
            {"disabled" in s && s.disabled ? (
              <span className="self-start text-sm text-fg-muted sm:self-center">{s.cta}</span>
            ) : (
              <Button asChild variant={s.done ? "ghost" : "secondary"} size="sm" className="self-start sm:self-center">
                <Link href={s.href}>{s.done ? "Review" : s.cta}</Link>
              </Button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
