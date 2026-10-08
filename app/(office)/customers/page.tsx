import { MagnifyingGlass, Plus, UsersThree } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Alert, EmptyState, PageHeader } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { formatPhone } from "@/lib/domain/contact";
import { searchCustomers } from "@/lib/server/customers";
import { serviceRequests } from "@/lib/server/messages";
import { formatLocalDate, pluralize } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const member = await requireMember(OFFICE_ROLES);
  const params = await searchParams;
  const q = params.q?.slice(0, 100) ?? "";
  const page = Number.parseInt(params.page ?? "1", 10) || 1;
  const [result, requests] = await Promise.all([searchCustomers(member, { q, page }), serviceRequests(member, { open: true })]);
  const pageHref = (n: number) => `/customers?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`;

  return (
    <div className="grid gap-2">
      <PageHeader
        title="Customers"
        description={result.total ? pluralize(result.total, q ? "match" : "customer", q ? "matches" : "customers") : undefined}
        actions={
          <Button asChild>
            <Link href="/customers/new">
              <Plus size={18} aria-hidden /> New customer
            </Link>
          </Button>
        }
      />

      {/* FR-POR-02: requests customers sent from their account. */}
      {requests.length ? (
        <Alert tone="warning" title={pluralize(requests.length, "service request")} className="mb-4">
          <ul className="grid gap-1">
            {requests.slice(0, 5).map((r) => (
              <li key={r.id}>
                <Link href={`/customers/${r.customer_id}`} className="font-medium hover:underline">
                  {r.display_name}
                </Link>
                : {r.message.length > 90 ? `${r.message.slice(0, 90)}…` : r.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <form role="search" action="/customers" className="flex max-w-xl gap-2 pb-4">
        <label htmlFor="customer-search" className="sr-only">
          Search customers
        </label>
        <Input id="customer-search" name="q" type="search" defaultValue={q} placeholder="Name, phone, email or street" autoComplete="off" />
        <Button type="submit" variant="secondary">
          <MagnifyingGlass size={18} aria-hidden /> Search
        </Button>
      </form>

      {result.total === 0 && !q ? (
        <EmptyState
          icon={<UsersThree size={28} aria-hidden />}
          title="No customers yet"
          action={
            <Button asChild>
              <Link href="/customers/new">Add your first customer</Link>
            </Button>
          }
        >
          Add a customer with their property and plan on one screen. Moving from another system? Self-serve import is on the way; until then we can load your export file for you.
        </EmptyState>
      ) : result.total === 0 ? (
        <EmptyState title={`Nothing matches "${q}"`}>Try part of a name, the last four digits of a phone number, or a street name.</EmptyState>
      ) : (
        <>
          <Table label="Customers">
            <THead>
              <tr>
                <TH>Name</TH>
                <TH className="hidden md:table-cell">Phone</TH>
                <TH className="hidden lg:table-cell">Address</TH>
                <TH className="text-right">Plans</TH>
                <TH>Next visit</TH>
              </tr>
            </THead>
            <TBody>
              {result.rows.map((c) => (
                <TR key={c.id}>
                  <TD className="max-w-64">
                    <Link href={`/customers/${c.id}`} className="block truncate font-medium text-fg hover:underline">
                      {c.display_name}
                    </Link>
                    {c.status === "inactive" ? <span className="text-sm text-fg-muted">Inactive</span> : null}
                  </TD>
                  <TD className="hidden whitespace-nowrap text-fg-muted tabular md:table-cell">{formatPhone(c.phone)}</TD>
                  <TD className="hidden max-w-72 truncate text-fg-muted lg:table-cell">{c.first_address}</TD>
                  <TD className="text-right tabular">{Number(c.active_plans ?? 0)}</TD>
                  <TD className="whitespace-nowrap tabular">{c.next_visit ? formatLocalDate(c.next_visit) : <span className="text-fg-muted">None</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {result.pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center justify-between pt-4">
              <p className="text-sm text-fg-muted tabular">
                Page {result.page} of {result.pages}
              </p>
              <div className="flex gap-2">
                {result.page > 1 ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={pageHref(result.page - 1)}>Previous</Link>
                  </Button>
                ) : null}
                {result.page < result.pages ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={pageHref(result.page + 1)}>Next</Link>
                  </Button>
                ) : null}
              </div>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
