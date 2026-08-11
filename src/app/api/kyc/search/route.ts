import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { isKycConfigured } from "@/lib/kyc/config";
import { searchCompanies } from "@/lib/kyc/companies-house";

/**
 * GET /api/kyc/search?q=acme  → Companies House name search (CRN picker).
 * Authenticated convenience endpoint; fails soft (503) when the Companies House
 * key is absent so the UI can show a "not configured" state.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isKycConfigured) {
    return NextResponse.json(
      { error: "Companies House API key not configured.", results: [] },
      { status: 503 },
    );
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const results = await searchCompanies(q);
  return NextResponse.json({ results });
}
