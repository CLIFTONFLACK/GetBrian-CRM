"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { getCompanyById } from "@/lib/db/queries/companies";
import { getAgencyOpenRouter } from "@/lib/openrouter/config";
import { runDeepDiveReport } from "@/lib/deep-dive/report";
import type { FormState } from "@/lib/actions/types";

/** Run an AI Deep Dive research report for a company (#deep-dive). */
export async function runDeepDive(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const companyId = String(formData.get("company_id") ?? "").trim();
  if (!companyId) return { error: "Missing company." };

  const cfg = await getAgencyOpenRouter(agencyId);
  if (!cfg) {
    return { error: "Add an OpenRouter API key in Admin to enable Deep Dive." };
  }

  const company = await getCompanyById(agencyId, companyId);
  if (!company) return { error: "Company not found." };

  try {
    await runDeepDiveReport(
      {
        id: company.id,
        name: company.name,
        sector_tags: company.sector_tags,
        website: company.website,
        address: [company.address_line, company.city, company.postcode]
          .filter(Boolean)
          .join(", "),
        company_number: company.company_number,
      },
      agencyId,
      session.user.id,
      cfg,
    );
  } catch (err) {
    return { error: (err as Error).message };
  }

  revalidatePath(`/companies/${companyId}`);
  return { message: "Deep Dive complete." };
}
