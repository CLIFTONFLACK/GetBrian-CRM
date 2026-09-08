"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { getCompanyById } from "@/lib/db/queries/companies";
import { getAgencyOpenRouter } from "@/lib/openrouter/config";
import { runDeepDiveReport } from "@/lib/deep-dive/report";
import { DEEP_DIVE_SYSTEM_PROMPT } from "@/lib/deep-dive/prompt";
import { openRouterChat } from "@/lib/openrouter/client";
import {
  addDeepDiveExchange,
  getLatestCompleteDeepDive,
  getLatestDeepDiveReportId,
  listDeepDiveMessages,
} from "@/lib/db/queries/deep-dive";

/** Turns of prior conversation replayed as context. The report itself is always
 *  included; this caps only the back-and-forth, which is what grows unbounded. */
const MAX_HISTORY_TURNS = 10;
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
      cfg.deepDivePrompt,
    );
  } catch (err) {
    return { error: (err as Error).message };
  }

  revalidatePath(`/companies/${companyId}`);
  return { message: "Deep Dive complete." };
}

/**
 * Ask a follow-up question about a company's Deep Dive report.
 *
 * The report is replayed to the model as context along with every previous turn
 * in the thread, so answers stay consistent with what the report actually said
 * rather than the model re-researching from scratch. That does mean each
 * question costs roughly the report's length in input tokens — the thread is
 * capped below for exactly that reason.
 *
 * The exchange is stored on the company (db/migrations/0040), so it persists on
 * the company profile and survives re-running the report.
 */
export async function askDeepDive(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const companyId = String(formData.get("company_id") ?? "").trim();
  if (!companyId) return { error: "Missing company." };
  const question = String(formData.get("question") ?? "").trim();
  if (!question) return { error: "Type a question first." };
  if (question.length > 2000) return { error: "That question is too long." };

  const cfg = await getAgencyOpenRouter(agencyId);
  if (!cfg) {
    return { error: "Add an OpenRouter API key in Admin to enable Deep Dive." };
  }

  const company = await getCompanyById(agencyId, companyId);
  if (!company) return { error: "Company not found." };

  const report = await getLatestCompleteDeepDive(agencyId, companyId);
  if (!report?.markdown) {
    return { error: "Run a Deep Dive first — there's no report to ask about yet." };
  }

  const history = await listDeepDiveMessages(agencyId, companyId);

  // Replay the report plus the recent turns. Older turns are dropped rather
  // than the report: without the report the model invents, whereas without the
  // first few questions it merely loses a little continuity.
  const recent = history.slice(-MAX_HISTORY_TURNS);
  let answer: string;
  try {
    answer = await openRouterChat({
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages: [
        {
          role: "system",
          content:
            `${DEEP_DIVE_SYSTEM_PROMPT}\n\n` +
            `You are answering follow-up questions about the research report below, ` +
            `on ${company.name}. Answer from the report where it covers the question. ` +
            `Where it doesn't, say so plainly and give your best assessment, labelled ` +
            `as such — never present a guess as a finding. Keep answers short.\n\n` +
            `--- REPORT ---\n${report.markdown}`,
        },
        ...recent.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: question },
      ],
    });
  } catch (err) {
    // A model or network fault must surface as a message rather than a crashed
    // action - and nothing is written, so the thread stays consistent.
    return { error: (err as Error).message };
  }

  const reportId = await getLatestDeepDiveReportId(agencyId, companyId);
  await addDeepDiveExchange(agencyId, {
    companyId,
    reportId,
    question,
    answer,
    createdBy: session.user.id,
  });

  revalidatePath(`/companies/${companyId}`);
  return { message: answer };
}
