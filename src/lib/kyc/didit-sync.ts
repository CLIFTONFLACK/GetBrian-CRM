import { revalidatePath } from "next/cache";

import { setDiditSessionError, updateDiditDecision } from "@/lib/db/queries/kyc";
import { getDecision, mapDecision, type DiditStatus } from "@/lib/kyc/providers/didit";

/**
 * Fetches one check's decision from Didit and saves it. Free: no session is
 * created. The "Refresh" button and the Didit webhook both use this, so the two
 * paths store exactly the same thing.
 *
 * The webhook does not use the decision in its own body. It calls this, so the
 * stored decision always comes from Didit's API under the agency's own key.
 *
 * On a Didit error the message is saved on the row and the error is thrown
 * again, so the caller can report it.
 */
export async function syncDiditDecision(
  agencyId: string,
  row: { session_id: string; company_id: string | null },
  apiKey: string,
): Promise<{ status: DiditStatus }> {
  // Taken BEFORE the fetch: a fetch that starts later sees a newer state, and
  // the save is skipped if a later fetch has already been saved.
  const fetchedAt = new Date();
  try {
    const decision = await getDecision(apiKey, row.session_id);
    const mapped = mapDecision(decision.raw);
    await updateDiditDecision(
      agencyId,
      row.session_id,
      decision.status,
      decision.raw,
      mapped.aml.length,
      mapped.document?.fullName ?? null,
      fetchedAt,
    );
    revalidatePath("/kyc");
    if (row.company_id) revalidatePath(`/companies/${row.company_id}`);
    return { status: decision.status };
  } catch (err) {
    await setDiditSessionError(agencyId, row.session_id, (err as Error).message);
    throw err;
  }
}
