import { Field } from "@/components/record-panel/fields";
import { StarRating } from "@/components/star-rating";
import { auth } from "@/lib/auth";
import { currentAgencyId, isAgencyAdmin } from "@/lib/db/queries/agencies";
import { getRequirementRatingContext } from "@/lib/db/queries/requirements";
import { canEditRating, RATING_NOT_ALLOWED } from "@/lib/listing-rating";

/**
 * Listing Rating row on the requirement panel's Overview tab. A server
 * component: it takes only the requirement id, so it looks up the caller, the
 * lead agent and the rating itself. Editable for the lead agent and agency
 * admins; everyone else sees the stars read-only with a helper line. The save
 * action checks the same rule again on the server.
 */
export async function RequirementRatingSlot({
  requirementId,
}: {
  requirementId: string;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return null;
  const row = await getRequirementRatingContext(agencyId, requirementId);
  if (!row) return null;

  const admin = await isAgencyAdmin(session.user.id, agencyId);
  const editable = canEditRating({
    userId: session.user.id,
    leadAgentId: row.lead_agent_id,
    isAdmin: admin,
  });

  return (
    <Field label="Listing rating">
      <div className="space-y-1">
        <StarRating
          value={row.listing_rating}
          requirementId={requirementId}
          readOnly={!editable}
        />
        {editable ? null : (
          <p className="text-xs text-muted-foreground">{RATING_NOT_ALLOWED}</p>
        )}
      </div>
    </Field>
  );
}
