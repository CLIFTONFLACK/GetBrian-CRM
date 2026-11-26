import { PanelSection } from "@/components/record-panel/fields";
import { LocationFlexSlider } from "@/components/location-flex-slider";
import { MatchOpportunities } from "@/components/match-opportunities";
import { Button } from "@/components/ui/button";
import { isListingMatchable } from "@/lib/badges";
import { getCompanyTypes } from "@/lib/company-types";
import { getAgencyMembers } from "@/lib/db/queries/agencies";
import { listCompanyOptions } from "@/lib/db/queries/companies";
import { getPrimaryContactForCompany, listContactOptions } from "@/lib/db/queries/contacts";
import { getExternalSendPairRows } from "@/lib/db/queries/deals";
import { listDisposalsForMatching } from "@/lib/db/queries/disposals";
import type { getRequirementById } from "@/lib/db/queries/requirements";
import { byMatchQuality, DEFAULT_LOCATION_FLEX, scoreMatch } from "@/lib/matching/score";
import { formatRecordRef, type RecordRef, type SearchParamsLike } from "@/lib/record-ref";

type Requirement = NonNullable<Awaited<ReturnType<typeof getRequirementById>>>;

/**
 * The record page's MatchMaker card, wired the same way: scorer, intel and CDG
 * listings (listing-type badge on every row), per-match send chips, Send Deal.
 *
 * The location-flex form is a GET form. It carries the panel's own params as
 * hidden inputs, otherwise Apply would submit `?flex=` alone and close the panel.
 */
export async function RequirementMatchmaker({
  agencyId,
  userId,
  requirement: r,
  record,
  base,
  flexParam,
}: {
  agencyId: string;
  userId: string;
  requirement: Requirement;
  record: RecordRef;
  base: SearchParamsLike;
  flexParam: string | undefined;
}) {
  const flexParsed = Number(flexParam ?? DEFAULT_LOCATION_FLEX);
  const locationFlex = Math.min(
    100,
    Math.max(0, Number.isFinite(flexParsed) ? flexParsed : DEFAULT_LOCATION_FLEX),
  );

  const contact = r.contact_id ? r.contact_id : null;
  const [members, companyOptions, contactOptions, companyTypes, disposals, primary] =
    await Promise.all([
      getAgencyMembers(agencyId),
      listCompanyOptions(agencyId),
      listContactOptions(agencyId),
      getCompanyTypes(),
      listDisposalsForMatching(agencyId),
      !contact && r.company_id
        ? getPrimaryContactForCompany(agencyId, r.company_id)
        : Promise.resolve(null),
    ]);
  // Who the Send Deal wizard pre-ticks: the brief's own contact, else the
  // operator's primary contact, else nobody.
  const defaultContactId = contact ?? primary;

  const matches = disposals
    .filter((d) => isListingMatchable(d.status))
    .map((d) => ({ d, ...scoreMatch(r, d, { locationFlex }) }))
    .filter((m) => m.score > 0)
    .sort(byMatchQuality((m) => m.d.id))
    .slice(0, 10);

  const matchListingIds = matches.map((m) => m.d.id);
  const pairSendRows = matchListingIds.length
    ? await getExternalSendPairRows(agencyId, [r.id], matchListingIds)
    : [];
  const sentByListing = new Map<string, { name: string; at: string }[]>();
  for (const s of pairSendRows) {
    if (!s.listing_id) continue;
    const list = sentByListing.get(s.listing_id) ?? [];
    list.push({
      name:
        [s.contact_first_name, s.contact_last_name].filter(Boolean).join(" ") ||
        s.recipient_email,
      at: s.created_at,
    });
    sentByListing.set(s.listing_id, list);
  }

  const hidden: Record<string, string> = { record: formatRecordRef(record), tab: "matchmaker" };
  for (const [k, v] of Object.entries(base)) {
    if (v && k !== "record" && k !== "tab" && k !== "flex") hidden[k] = v;
  }

  return (
    <PanelSection
      title="MatchMaker opportunities"
      action={
        <form className="flex items-end gap-2">
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <LocationFlexSlider defaultValue={locationFlex} />
          <Button type="submit" size="sm" variant="secondary">
            Apply
          </Button>
        </form>
      }
    >
      <MatchOpportunities
        opportunities={matches.map(({ d, score, reasons, thin, coverage, missing }) => ({
          id: d.id,
          title: d.title ?? "Untitled listing",
          city: d.city,
          listingType: d.listing_type,
          score,
          reasons,
          thin,
          coverage,
          missing,
          previousSends: sentByListing.get(d.id),
        }))}
        requirementId={r.id}
        requirementTitle={r.title}
        agents={members}
        meId={userId}
        companies={companyOptions}
        contacts={contactOptions}
        companyTypes={companyTypes}
        defaultContactIds={defaultContactId ? [defaultContactId] : undefined}
      />
    </PanelSection>
  );
}
