import type { Metadata } from "next";

import { CompanyForm } from "@/components/company-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { createCompany } from "@/lib/actions/companies";
import { getCompanyTypes } from "@/lib/company-types";
import { getContactRoles } from "@/lib/contact-roles";
import { currentAgencyId, getAgencyMembers } from "@/lib/supabase/agency";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New company" };

export default async function NewCompanyPage() {
  const supabase = await createClient();
  const agencyId = await currentAgencyId(supabase);
  const agents = agencyId ? await getAgencyMembers(supabase, agencyId) : [];
  const types = await getCompanyTypes();
  // Feeds the full "+ New contact" form inside the company form's modal.
  const contactRoles = await getContactRoles();

  const { data: contactRows } = await supabase
    .from("contacts")
    .select("id, first_name, last_name")
    .order("first_name");
  const contacts = (contactRows ?? []).map((c) => ({
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(" "),
  }));

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
