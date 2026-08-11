import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CompanyForm } from "@/components/company-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { createCompany } from "@/lib/actions/companies";
import { getCompanyTypes } from "@/lib/company-types";
import { getContactRoles } from "@/lib/contact-roles";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { listContactOptions } from "@/lib/db/queries/contacts";
import { isDbConfigured } from "@/lib/db/client";

export const metadata: Metadata = { title: "New company" };

export default async function NewCompanyPage() {
  if (!isDbConfigured) redirect("/login");
  const session = await auth();
  if (!session?.user) redirect("/login");

  const agencyId = await currentAgencyId(session.user.id);
  const [agents, types, contactRoles, contacts] = await Promise.all([
    agencyId ? getAgencyMembers(agencyId) : Promise.resolve([]),
    getCompanyTypes(),
    // Feeds the full "+ New contact" form inside the company form's modal.
    getContactRoles(),
    agencyId ? listContactOptions(agencyId) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New company"
        description="Add an operator, landlord, agent or vendor."
      />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <CompanyForm
            action={createCompany}
            agents={agents}
            contacts={contacts}
            types={types}
            contactRoles={contactRoles}
          />
        </CardContent>
      </Card>
    </div>
  );
}
