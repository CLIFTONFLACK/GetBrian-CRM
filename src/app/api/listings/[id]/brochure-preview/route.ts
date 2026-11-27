import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { ensureBrochurePreview } from "@/lib/disposals/brochure-preview-service";
import { isUuid } from "@/lib/uuid";

// Fetching and drawing a PDF can take a few seconds.
export const maxDuration = 60;

/**
 * POST /api/listings/[id]/brochure-preview
 *
 * Makes (or returns) the page 1 image of the listing's brochure. The link is
 * read from the database for the caller's own agency; nothing is taken from the
 * request body. A listing in another agency, an unknown id and a signed-out
 * caller all get the same 404.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!id || !isUuid(id)) return notFound();

  const session = await auth();
  if (!session?.user) return notFound();
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return notFound();

  const result = await ensureBrochurePreview(agencyId, id);
  if (result.status === "missing") return notFound();
  return NextResponse.json(result.status === "ready" ? { url: result.url } : { url: null, reason: result.reason });
}

function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}
