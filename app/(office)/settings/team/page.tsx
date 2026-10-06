import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { canManage, OFFICE_ROLES, requireMember } from "@/lib/auth/session";
import { instantToZoned } from "@/lib/domain/time";
import { listTeam } from "@/lib/server/team";
import { formatLocalDate } from "@/lib/ui/format";
import { InviteForm } from "../forms";

export const metadata: Metadata = { title: "Team" };

const ROLE = { owner: "Owner", admin: "Admin", office: "Office", dispatcher: "Dispatcher", technician: "Technician" } as Record<string, string>;

export default async function TeamPage() {
  const member = await requireMember(OFFICE_ROLES);
  const team = await listTeam(member);
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <Table label="Team members">
        <THead>
          <tr>
            <TH>Person</TH>
            <TH>Role</TH>
            <TH className="hidden sm:table-cell">Since</TH>
          </tr>
        </THead>
        <TBody>
          {team.map((t) => (
            <TR key={t.id}>
              <TD>
                <p className="font-medium">{t.display_name ?? t.email}</p>
                {t.display_name ? <p className="text-sm text-fg-muted">{t.email}</p> : null}
              </TD>
              <TD>{t.deactivated_at ? <Badge tone="danger">Removed</Badge> : <Badge tone={t.role === "owner" ? "accent" : "neutral"}>{ROLE[t.role]}</Badge>}</TD>
              <TD className="hidden text-fg-muted tabular sm:table-cell">{formatLocalDate(instantToZoned(t.created_at, member.timezone).date, "full")}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {canManage(member.role) ? (
        <Panel>
          <PanelHeader title="Invite someone" description="Unlimited users on every plan." />
          <div className="px-5 py-4">
            <InviteForm isOwner={member.role === "owner"} />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
