import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { currentAgencyId, isAgencyAdmin } from "@/lib/db/queries/agencies";
import { getAgencyDiditKey } from "@/lib/kyc/didit-config";
import { listWorkflows } from "@/lib/kyc/providers/didit";

/**
 * GET /api/kyc/didit/workflows → the Didit account's workflows, for the Admin
 * page's identity-workflow picker.
 *
 * Admin-only. It reveals what the agency's Didit account is configured to do
 * (and its per-session prices), which is admin-surface information — and it is
 * the one call that proves a saved key works, so it doubles as the card's
 * "Test key" button. The key itself never leaves the server: the client posts
 * nothing and receives only workflow metadata.
 *
 * Free on Didit's side — listing workflows is not a billed operation, unlike
 * creating a session.
 */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) {
    return NextResponse.json(
      { error: "No agency is linked to your account." },
      { status: 403 },
    );
  }
  if (!(await isAgencyAdmin(session.user.id, agencyId))) {
    return NextResponse.json(
      { error: "Only an agency admin can do that." },
      { status: 403 },
    );
  }

  const apiKey = await getAgencyDiditKey(agencyId);
  if (!apiKey) {
    return NextResponse.json(
      { error: "Save a Didit API key first.", workflows: [] },
      { status: 400 },
    );
  }

  try {
    const workflows = await listWorkflows(apiKey);
    return NextResponse.json({ workflows });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, workflows: [] },
      { status: 502 },
    );
  }
}
