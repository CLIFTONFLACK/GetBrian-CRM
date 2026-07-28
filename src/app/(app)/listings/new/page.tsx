import type { Metadata } from "next";

import { DisposalForm } from "@/components/disposal-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { createDisposal } from "@/lib/actions/disposals";
import { getCompanyTypes } from "@/lib/company-types";
import { getContactRoles } from "@/lib/contact-roles";
import { currentAgencyId, getAgencyMembers } from "@/lib/supabase/agency";
import { getCompanyOptions, getContactOptions } from "@/lib/supabase/pickers";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New listing" };

export default async function NewListingPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const { company: defaultCompanyId } = await searchParams;
  const supabase = await createClient();
  const agencyId = await currentAgencyId(supabase);
  const [agents, companies, contacts] = agencyId
    ? await Promise.all([
        getAgencyMembers(supabase, agencyId),
        getCompanyOptions(supabase, agencyId),
        getContactOptions(supabase, agencyId),
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
