import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DisposalForm } from "@/components/disposal-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { createDisposal } from "@/lib/actions/disposals";
import { getCompanyTypes } from "@/lib/company-types";
import { getContactRoles } from "@/lib/contact-roles";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { listCompanyOptions } from "@/lib/db/queries/companies";
import { listContactOptions } from "@/lib/db/queries/contacts";

export const metadata: Metadata = { title: "New listing" };

export default async function NewListingPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const { company: defaultCompanyId } = await searchParams;

  if (!isDbConfigured) redirect("/login");
  const session = await auth();
  if (!session?.user) redirect("/login");
  const agencyId = await currentAgencyId(session.user.id);

  const [agents, companies, contacts] = agencyId
    ? await Promise.all([
        getAgencyMembers(agencyId),
        listCompanyOptions(agencyId),
        listContactOptions(agencyId),
      ])
    : [[], [], []];
  const companyTypes = await getCompanyTypes();
  // Both feed the full "+ New …" forms inside the listing form's modals.
  const contactRoles = await getContactRoles();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New listing"
        description="Add a leisure premises to your supply book."
      />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <DisposalForm
            action={createDisposal}
            agents={agents}
            companies={companies}
            contacts={contacts}
            companyTypes={companyTypes}
            contactRoles={contactRoles}
            defaultCompanyId={defaultCompanyId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
