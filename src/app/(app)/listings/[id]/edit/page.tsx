import { notFound } from "next/navigation";

import { DisposalForm } from "@/components/disposal-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { updateDisposal } from "@/lib/actions/disposals";
import { getCompanyTypes } from "@/lib/company-types";
import { getContactRoles } from "@/lib/contact-roles";
import { getAgencyMembers } from "@/lib/supabase/agency";
import { getCompanyOptions, getContactOptions } from "@/lib/supabase/pickers";
import { createClient } from "@/lib/supabase/server";

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: disposal } = await supabase
    .from("disposals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!disposal) notFound();

  const { data: agentRows } = await supabase
    .from("disposal_agents")
    .select("user_id")
    .eq("disposal_id", id);
  const [agents, companies, contacts, companyTypes, contactRoles] = await Promise.all([
    getAgencyMembers(supabase, disposal.agency_id),
    getCompanyOptions(supabase, disposal.agency_id),
    getContactOptions(supabase, disposal.agency_id),
    getCompanyTypes(),
    getContactRoles(),
  ]);
  const additionalAgentIds = (agentRows ?? []).map((r) => r.user_id);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Edit listing" description={disposal.title ?? "Untitled listing"} />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <DisposalForm
            action={updateDisposal}
            disposal={disposal}
            agents={agents}
            additionalAgentIds={additionalAgentIds}
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
