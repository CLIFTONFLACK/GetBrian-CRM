import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pencil, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { contactRoleBadge } from "@/lib/badges";
import { auth } from "@/lib/auth";
import { getContactRoles, roleLabel } from "@/lib/contact-roles";
import { deleteContact } from "@/lib/actions/contacts";
import { ActivityTimeline } from "@/components/activity-timeline";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { LocationMap } from "@/components/location-map";
import { LogActivityForm } from "@/components/log-activity-form";
import { SendToTeam } from "@/components/send-to-team";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { getCompanyName } from "@/lib/db/queries/companies";
import { getContactAgentIds, getContactById } from "@/lib/db/queries/contacts";
import { listActivitiesForEntity } from "@/lib/db/queries/activities";
import { listRequirementsForContact } from "@/lib/db/queries/requirements";
import { requirementStatusBadge } from "@/lib/badges";
import { cn } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  if (!isDbConfigured) return { title: "Contact" };
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return { title: "Contact" };
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { title: "Contact" };
  const contact = await getContactById(agencyId, id);
  const name = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ");
  return { title: name || "Contact" };
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isDbConfigured) redirect("/login");
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id;

  const agencyId = await currentAgencyId(userId);
  if (!agencyId) notFound();

  const contact = await getContactById(agencyId, id);
  if (!contact) notFound();

  const [companyName, agentRows, members, activities, requirements] = await Promise.all([
    contact.company_id ? getCompanyName(agencyId, contact.company_id) : Promise.resolve(null),
    getContactAgentIds(agencyId, id),
    getAgencyMembers(agencyId),
    listActivitiesForEntity(agencyId, "contact", id, 20),
    listRequirementsForContact(agencyId, id),
  ]);

  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const leadAgentName = contact.lead_agent_id
    ? (nameOf.get(contact.lead_agent_id) ?? "Unknown agent")
    : null;
  const additionalAgents = agentRows.map((agentId) => ({
    id: agentId,
    name: nameOf.get(agentId) ?? "Unknown agent",
  }));

  const roles = await getContactRoles();
  const r = contactRoleBadge(contact.role, roleLabel(roles, contact.role));
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
  const address = [contact.address_line, contact.city, contact.postcode]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
          <Badge tone={r.tone}>{r.label}</Badge>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <SendToTeam
            link={`/contacts/${contact.id}`}
            subject={name}
            agents={members}
            meId={userId}
          />
          <Link
            href={`/contacts/${contact.id}/edit`}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            <Pencil />
            Edit
          </Link>
          <form action={deleteContact}>
            <input type="hidden" name="id" value={contact.id} />
            <ConfirmSubmitButton
              confirmMessage="Delete this contact? Their activity history and agent links will be removed, any linked listings or requirements will lose this contact, and this can't be undone."
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10"
            >
              Delete
            </ConfirmSubmitButton>
          </form>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Company">
            {contact.company_id ? (
              <Link
                href={`/companies/${contact.company_id}`}
                className="text-info hover:underline"
              >
                {companyName ?? "View company"}
              </Link>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Email">
            {contact.email ? (
              <a href={`mailto:${contact.email}`} className="text-info hover:underline">
                {contact.email}
              </a>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Phone">{contact.phone ?? "—"}</Row>
          <Row label="Address">{address || "—"}</Row>
          <Row label="Lead agent">{leadAgentName ?? "—"}</Row>
          <Row label="Agents">
            {additionalAgents.length > 0 ? (
              <span className="flex flex-wrap gap-1.5">
                {additionalAgents.map((a) => (
                  <Badge key={a.id} tone="slate">
                    {a.name}
                  </Badge>
                ))}
              </span>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Marketing">
            <Badge tone={contact.marketing_opt_in ? "emerald" : "slate"}>
              {contact.marketing_opt_in ? "Yes" : "No"}
            </Badge>
          </Row>
          {/* KYC runs against the company, so this only appears once the
              contact is linked to one. */}
          {contact.company_id ? (
            <Row label="KYC">
              <Link
                href={`/kyc?company=${contact.company_id}`}
                className="text-info hover:underline"
              >
                Run KYC report on {companyName ?? "their company"}
              </Link>
            </Row>
          ) : null}
          <Row label="Notes">
            <span className="whitespace-pre-wrap">{contact.notes ?? "—"}</span>
          </Row>
        </CardContent>
      </Card>

      {/* Requirements briefed against this person. The contact_id link has
          existed since 0001 but was write-only — you could brief a requirement
          against someone and never see it from their record. Mirrors the
          company page's Requirements card. */}
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Requirements</CardTitle>
          <Link
            href={`/requirements/new?contact=${contact.id}${
              contact.company_id ? `&company=${contact.company_id}` : ""
            }`}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            <Plus />
            Add requirement
          </Link>
        </CardHeader>
        <CardContent>
          {requirements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No requirements briefed against this contact yet.
            </p>
          ) : (
            <ul className="divide-y">
              {requirements.map((rq) => {
                const rs = requirementStatusBadge(rq.status);
                return (
                  <li
                    key={rq.id}
                    className="flex items-center justify-between gap-2 py-2 text-sm"
                  >
                    <Link
                      href={`/requirements/${rq.id}`}
                      className="font-medium text-foreground hover:text-info hover:underline"
                    >
                      {rq.title}
                    </Link>
                    <Badge tone={rs.tone}>{rs.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {contact.lat != null && contact.lng != null ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Location</CardTitle>
          </CardHeader>
          <CardContent>
            <LocationMap lat={contact.lat} lng={contact.lng} label={name} />
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <LogActivityForm entityType="contact" entityId={contact.id} />
          <ActivityTimeline
            activities={activities}
            actorNames={Object.fromEntries(nameOf)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}
