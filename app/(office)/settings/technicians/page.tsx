import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Panel } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { canManage, OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { daysBetween, parseLocalDate, todayIn } from "@/lib/domain/time";
import { formatPhone } from "@/lib/domain/contact";
import { listTechnicians } from "@/lib/server/catalog";
import { formatLocalDate } from "@/lib/ui/format";
import { TechnicianForm } from "../forms";

export const metadata: Metadata = { title: "Technicians" };

export default async function TechniciansPage() {
  const member = await requireMember(OFFICE_ROLES);
  const techs = await listTechnicians(member);
  const today = todayIn(member.timezone);

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
      {techs.length === 0 ? (
        <EmptyState title="No technicians yet">Add each technician with their applicator license. The number and expiry are copied onto every application record they sign.</EmptyState>
      ) : (
        <Table label="Technicians">
          <THead>
            <tr>
              <TH>Technician</TH>
              <TH>License</TH>
              <TH>Expires</TH>
            </tr>
          </THead>
          <TBody>
            {techs.map((t) => {
              const daysLeft = daysBetween(today, parseLocalDate(t.license_expiry));
              return (
                <TR key={t.id}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <span className="size-3 shrink-0 rounded-pill" style={{ backgroundColor: `var(--rk-route-${t.color_index})` }} aria-hidden />
                      <div>
                        <p className="font-medium">{t.display_name}</p>
                        {t.phone ? <p className="text-sm text-fg-muted tabular">{formatPhone(t.phone)}</p> : null}
                      </div>
                    </div>
                  </TD>
                  <TD className="font-mono text-sm">{t.applicator_license_no}</TD>
                  <TD className="whitespace-nowrap tabular">
                    {formatLocalDate(t.license_expiry, "full")}
                    {daysLeft < 0 ? (
                      <Badge tone="danger" className="ml-2">Expired</Badge>
                    ) : daysLeft <= 60 ? (
                      <Badge tone="warning" className="ml-2">Renew soon</Badge>
                    ) : null}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
      {canManage(member.role) ? (
        <Panel title="Add a technician">
          <div className="px-5 py-4">
            <TechnicianForm nextColor={techs.length % 12} />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
