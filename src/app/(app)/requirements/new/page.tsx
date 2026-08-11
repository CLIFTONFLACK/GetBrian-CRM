import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RequirementForm } from "@/components/requirement-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { createRequirement } from "@/lib/actions/requirements";
import { getCompanyTypes } from "@/lib/company-types";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { listCompanyOptions } from "@/lib/db/queries/companies";
import { listContactOptions } from "@/lib/db/queries/contacts";

export const metadata: Metadata = { title: "New requirement" };

export default async function NewRequirementPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const { company } = await searchParams;

  if (!isDbConfigured) redirect("/login");
  const session = await auth();
  if (!session?.user) redirect("/login");
  const agencyId = await currentAgencyId(session.user.id);

  const [companies, agents, contacts] = agencyId
    ? await Promise.all([
        listCompanyOptions(agencyId),
        getAgencyMembers(agencyId),
        listContactOptions(agencyId),
      ])
    : [[], [], []];
  const companyTypes = await getCompanyTypes();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New requirement"
        description="The operator requirement used to match against disposals."
      />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <RequirementForm
            action={createRequirement}
            companies={companies}
            contacts={contacts}
            companyTypes={companyTypes}
            defaultCompanyId={company}
            agents={agents}
          />
        </CardContent>
      </Card>
    </div>
  );
}
