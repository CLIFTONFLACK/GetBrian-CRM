import { createElement, type ReactElement } from "react";

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";

import { auth } from "@/lib/auth";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { getCompanyName } from "@/lib/db/queries/companies";
import { getLatestCompleteDeepDive } from "@/lib/db/queries/deep-dive";
import { registerBrandFonts } from "@/lib/pdf/fonts";
import { DeepDiveDocument } from "@/lib/pdf/deep-dive-document";

// react-pdf + bundled TTFs need the Node runtime (not Edge).
export const runtime = "nodejs";

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "company";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return new Response("Unauthorized", { status: 401 });

  const name = await getCompanyName(agencyId, id);
  const report = await getLatestCompleteDeepDive(agencyId, id);

  if (!report?.markdown) return new Response("No Deep Dive report yet", { status: 404 });

  registerBrandFonts();
  const title = name ?? "Company";
  const element = createElement(DeepDiveDocument, {
    title,
    markdown: report.markdown,
    generatedOn: new Date(report.created_at).toLocaleDateString("en-GB"),
  }) as unknown as ReactElement<DocumentProps>;
  const pdf = await renderToBuffer(element);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${slug(title)}-deep-dive.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
