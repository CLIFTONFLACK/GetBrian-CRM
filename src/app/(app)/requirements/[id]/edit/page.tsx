import { notFound, redirect } from "next/navigation";

import { RequirementForm } from "@/components/requirement-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { updateRequirement } from "@/lib/actions/requirements";
import { getCompanyTypes } from "@/lib/company-types";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { listCompanyOptions } from "@/lib/db/queries/companies";
import { listContactOptions } from "@/lib/db/queries/contacts";
import {
  getRequirementAgentIds,
  getRequirementById,
} from "@/lib/db/queries/requirements";

export default async function EditRequirementPage({
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

  const requirement = await getRequirementById(agencyId, id);
  if (!requirement) notFound();

  const [companies, contacts, companyTypes, agentIds, agents] = await Promise.all([
    listCompanyOptions(agencyId),
    listContactOptions(agencyId),
    getCompanyTypes(),
    getRequirementAgentIds(agencyId, id),
    getAgencyMembers(agencyId),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Edit requirement" description={requirement.title} />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <RequirementForm
            action={updateRequirement}
            requirement={requirement}
            companies={companies}
            contacts={contacts}
            companyTypes={companyTypes}
            agents={agents}
            additionalAgentIds={agentIds}
          />
        </CardContent>
      </Card>
    </div>
  );
}
