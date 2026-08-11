import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { getDisposalDocumentByIdUnsafe } from "@/lib/db/queries/disposals";
import { authorizeDisposalDocument, verifyDocToken } from "@/lib/disposal-docs";

/**
 * GET /api/disposal-docs/[id]?exp=…&sig=…
 *
 * Authorization-checking proxy for the private `disposal-docs` Blob
 * "bucket" — see src/lib/disposal-docs.ts for the full design note. Two
 * independent ways in, tried in order:
 *
 *   1. A valid, unexpired `exp`/`sig` pair (minted by `signDisposalDocUrl`
 *      when the listing detail page rendered) — a bearer credential, no
 *      session required, mirroring the Supabase `createSignedUrls(paths,
 *      3600)` link it replaces.
 *   2. No (valid) token — falls back to a live session check: `auth()`,
 *      resolve `agencyId`, confirm the document belongs to that agency.
 *
 * Both paths reject with the same 404 on any failure (wrong agency, no
 * session, unknown id, tampered/expired signature) — never a 403 — so a
 * cross-tenant probe can't distinguish "doesn't exist" from "exists, not
 * yours".
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!id) return notFound();

  const { searchParams } = new URL(request.url);
  const expRaw = searchParams.get("exp");
  const sig = searchParams.get("sig");

  let filePath: string | null = null;

  if (expRaw && sig && verifyDocToken(id, Number(expRaw), sig)) {
    const doc = await getDisposalDocumentByIdUnsafe(id);
    filePath = doc?.file_path ?? null;
  } else {
    const session = await auth();
    if (session?.user) {
      const agencyId = await currentAgencyId(session.user.id);
      if (agencyId) {
        const doc = await authorizeDisposalDocument(agencyId, id);
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
