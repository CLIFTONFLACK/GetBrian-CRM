import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ContactForm } from "@/components/contact-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { createContact } from "@/lib/actions/contacts";
import { getCompanyTypes } from "@/lib/company-types";
import { getContactRoles } from "@/lib/contact-roles";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { listCompanyOptions } from "@/lib/db/queries/companies";

export const metadata: Metadata = { title: "New contact" };

export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  if (!isDbConfigured) redirect("/login");
  const { company } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const agencyId = await currentAgencyId(session.user.id);
  const [companies, agents, roles, companyTypes] = await Promise.all([
    agencyId ? listCompanyOptions(agencyId) : Promise.resolve([]),
    agencyId ? getAgencyMembers(agencyId) : Promise.resolve([]),
    getContactRoles(),
    getCompanyTypes(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New contact" description="Add a person and link them to a company." />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <ContactForm
            action={createContact}
            companies={companies}
            defaultCompanyId={company}
            agents={agents}
            roles={roles}
            companyTypes={companyTypes}
          />
        </CardContent>
      </Card>
    </div>
  );
}
