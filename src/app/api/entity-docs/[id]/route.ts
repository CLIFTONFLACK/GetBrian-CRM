import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { getEntityDocumentByIdUnsafe } from "@/lib/db/queries/entity-documents";
import { authorizeEntityDocument, verifyEntityDocToken } from "@/lib/entity-doc-sign";
import { isUuid } from "@/lib/uuid";

/**
 * GET /api/entity-docs/[id]?exp=...&sig=...
 *
 * Authorization-checking proxy for company and contact documents held in Vercel
 * Blob. Same two ways in as /api/requirement-docs/[id]: a valid unexpired
 * exp/sig pair made by signEntityDocUrl, or a live session whose agency owns the
 * document. Every failure gives the same 404, so a probe cannot tell "missing"
 * from "not yours".
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!id || !isUuid(id)) return notFound();

  const { searchParams } = new URL(request.url);
  const expRaw = searchParams.get("exp");
  const sig = searchParams.get("sig");

  let filePath: string | null = null;

  if (expRaw && sig && verifyEntityDocToken(id, Number(expRaw), sig)) {
    const doc = await getEntityDocumentByIdUnsafe(id);
    filePath = doc?.file_path ?? null;
  } else {
    const session = await auth();
    if (session?.user) {
      const agencyId = await currentAgencyId(session.user.id);
      if (agencyId) {
        const doc = await authorizeEntityDocument(agencyId, id);
        filePath = doc?.file_path ?? null;
      }
    }
  }

  if (!filePath) return notFound();
  return NextResponse.redirect(filePath, 302);
}

function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}
