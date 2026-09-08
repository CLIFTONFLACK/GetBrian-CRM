import { notFound, redirect } from "next/navigation";

import { CompanyForm } from "@/components/company-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { updateCompany } from "@/lib/actions/companies";
import { getCompanyTypes } from "@/lib/company-types";
import { getContactRoles } from "@/lib/contact-roles";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { getCompanyAgentIds, getCompanyById } from "@/lib/db/queries/companies";
import { listContactOptions, listContactsByCompany } from "@/lib/db/queries/contacts";

export default async function EditCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isDbConfigured) redirect("/login");
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) notFound();

  const company = await getCompanyById(agencyId, id);
  if (!company) notFound();

  const [agents, agentIds, types, contactRoles, contacts, ownContacts] =
    await Promise.all([
      getAgencyMembers(agencyId),
      getCompanyAgentIds(agencyId, id),
      getCompanyTypes(),
      // Feeds the full "+ New contact" form inside the company form's modal.
      getContactRoles(),
      listContactOptions(agencyId),
      listContactsByCompany(agencyId, id),
    ]);

  // The contact picker is required on edit as well as create, so pre-select the
  // company's existing contact — a compliant company then saves with no extra
  // clicks. A legacy company with no contacts arrives blank and has to be given
  // one, which is the intended backfill.
  const defaultContactId = ownContacts[0]?.id;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Edit company" description={company.name} />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <CompanyForm
            action={updateCompany}
            company={company}
            agents={agents}
            additionalAgentIds={agentIds}
            types={types}
            contacts={contacts}
            contactRoles={contactRoles}
            defaultContactId={defaultContactId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
