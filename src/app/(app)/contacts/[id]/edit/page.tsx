import { notFound, redirect } from "next/navigation";

import { ContactForm } from "@/components/contact-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { updateContact } from "@/lib/actions/contacts";
import { getCompanyTypes } from "@/lib/company-types";
import { getContactRoles } from "@/lib/contact-roles";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { listCompanyOptions } from "@/lib/db/queries/companies";
import { getContactAgentIds, getContactById } from "@/lib/db/queries/contacts";

export default async function EditContactPage({
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

  const contact = await getContactById(agencyId, id);
  if (!contact) notFound();

  const [companies, agents, agentIds, roles, companyTypes] = await Promise.all([
    listCompanyOptions(agencyId),
    getAgencyMembers(agencyId),
    getContactAgentIds(agencyId, id),
    getContactRoles(),
    getCompanyTypes(),
  ]);

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Edit contact" description={name} />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <ContactForm
            action={updateContact}
            contact={contact}
            companies={companies}
            agents={agents}
            additionalAgentIds={agentIds}
            roles={roles}
            companyTypes={companyTypes}
          />
        </CardContent>
      </Card>
    </div>
  );
}
