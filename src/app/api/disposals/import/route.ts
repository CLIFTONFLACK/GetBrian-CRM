import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { importDisposalFromUrl, isCdgPropertyUrl } from "@/lib/disposals/import";

/**
 * POST /api/disposals/import  { "url": "https://www.cdgleisure.com/find-a-property/..." }
 *
 * Programmatic equivalent of the import Server Action — handy for scripted/bulk
 * ingestion. Next 16: route handlers aren't cached by default and `request.json()`
 * needs no body parser. Auth is verified here (the handler is publicly reachable).
 *
 * Session + agency resolution goes through Auth.js + the Neon DAO
 * (agencies.ts's `currentAgencyId`); the media re-host step inside
 * `importDisposalFromUrl` goes through Vercel Blob (storage.ts's `put()`,
 * reading `BLOB_READ_WRITE_TOKEN` from `process.env` — no client object
 * needed for either step any more).
 */
export async function POST(request: Request): Promise<Response> {
  if (!isDbConfigured) {
    return NextResponse.json({ error: "The database isn't configured yet." }, { status: 503 });
  }

  let url: string;
  try {
    const body = (await request.json()) as { url?: unknown };
    url = String(body.url ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Body must be JSON: { url }." }, { status: 400 });
  }
  if (!url || !isCdgPropertyUrl(url)) {
    return NextResponse.json({ error: "A valid CDG property URL is required." }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) {
    return NextResponse.json(
      { error: "No agency linked to this account." },
      { status: 403 },
    );
  }

  try {
    const { id, rehost } = await importDisposalFromUrl(url, agencyId, {
      createdBy: session.user.id,
    });
    return NextResponse.json({
      id,
      rehosted: rehost?.uploaded ?? 0,
      warnings: rehost?.failures ?? [],
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
