import { notFound, redirect } from "next/navigation";

import { DisposalForm } from "@/components/disposal-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { updateDisposal } from "@/lib/actions/disposals";
import { getCompanyTypes } from "@/lib/company-types";
import { getContactRoles } from "@/lib/contact-roles";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { listCompanyOptions } from "@/lib/db/queries/companies";
import { listContactOptions } from "@/lib/db/queries/contacts";
import {
  getDisposalAgentIds,
  getDisposalById,
} from "@/lib/db/queries/disposals";

export default async function EditListingPage({
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

  const disposal = await getDisposalById(agencyId, id);
  if (!disposal) notFound();

  const [agentIds, agents, companies, contacts, companyTypes, contactRoles] =
    await Promise.all([
      getDisposalAgentIds(agencyId, id),
      getAgencyMembers(agencyId),
      listCompanyOptions(agencyId),
      listContactOptions(agencyId),
      getCompanyTypes(),
      getContactRoles(),
    ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Edit listing" description={disposal.title ?? "Untitled listing"} />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <DisposalForm
            action={updateDisposal}
            disposal={disposal}
            agents={agents}
            additionalAgentIds={agentIds}
            companies={companies}
            contacts={contacts}
            companyTypes={companyTypes}
            contactRoles={contactRoles}
          />
        </CardContent>
      </Card>
    </div>
  );
}
