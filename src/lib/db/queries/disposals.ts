import { sql } from "@/lib/db/client";
import { ilikeTerm } from "@/lib/search";
import type { DisposalInsert } from "@/lib/disposals/cdg";

// DAO for public.disposals (+ disposal_agents, disposal_areas, and read-only
// access to disposal_documents metadata). Every function takes the caller's
// agencyId as a mandatory first parameter and filters on it explicitly — see
// the same note in companies.ts. disposal_documents/disposal_images upload +
// Supabase Storage operations stay on the Supabase client until their own
// migration batch (see AGENTS.md) — only their metadata reads live here.

/** Full row shape — feeds the detail/edit pages and the particulars PDF. */
export type Disposal = {
  id: string;
  agency_id: string;
  source: string;
  source_ref: string | null;
  source_url: string | null;
  status: string | null;
  source_updated_at: string | null;
  title: string | null;
  summary: string | null;
  address_line: string | null;
  area: string | null;
  city: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  property_type: string | null;
  use_class: string | null;
  disposal_type: string;
  to_let: boolean;
  for_sale: boolean;
  rent_pa: number | null;
  rent_raw: string | null;
  rent_period: string | null;
  premium: number | null;
  premium_raw: string | null;
  guide_price: number | null;
  price_qualifier: string | null;
  vat_applicable: boolean | null;
  rateable_value: number | null;
  business_rates: number | null;
  service_charge: number | null;
  estate_charge: number | null;
  parking_charge: number | null;
  tenure_raw: string | null;
  lease_term_years: number | null;
  lease_expiry: string | null;
  rent_review_basis: string | null;
  next_rent_review: number | null;
  inside_1954_act: boolean | null;
  size_sqft: number | null;
  size_sqm: number | null;
  covers_internal: number | null;
  covers_external: number | null;
  floors: unknown;
  licensing_notes: string | null;
  fit_out_state: string | null;
  epc_rating: string | null;
  description: string | null;
  location_description: string | null;
  key_features: string[];
  sections: unknown;
  agent_name: string | null;
  agent_email: string | null;
  agent_phone: string | null;
  agent_photo: string | null;
  images: unknown;
  brochure_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  lead_agent_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  listing_type: string;
  county: string | null;
};

const FULL_COLUMNS = `
  id, agency_id, source, source_ref, source_url, status, source_updated_at::text as source_updated_at,
  title, summary, address_line, area, city, postcode, lat, lng,
  property_type, use_class, disposal_type, to_let, for_sale,
  rent_pa::float8 as rent_pa, rent_raw, rent_period, premium::float8 as premium, premium_raw,
  guide_price::float8 as guide_price, price_qualifier,
  vat_applicable, rateable_value::float8 as rateable_value, business_rates::float8 as business_rates,
  service_charge::float8 as service_charge, estate_charge::float8 as estate_charge, parking_charge::float8 as parking_charge,
  tenure_raw, lease_term_years, lease_expiry::text as lease_expiry, rent_review_basis, next_rent_review, inside_1954_act,
  size_sqft::float8 as size_sqft, size_sqm::float8 as size_sqm, covers_internal, covers_external, floors,
  licensing_notes, fit_out_state, epc_rating,
  description, location_description, key_features, sections,
  agent_name, agent_email, agent_phone, agent_photo,
  images, brochure_url,
  created_by, created_at::text as created_at, updated_at::text as updated_at,
  lead_agent_id, company_id, contact_id, listing_type, county
`;

/** Full row for the detail/edit pages and the particulars PDF. */
export async function getDisposalById(agencyId: string, id: string): Promise<Disposal | null> {
  const rows = await sql`
    select ${sql.unsafe(FULL_COLUMNS)}
    from public.disposals
    where id = ${id} and agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as Disposal | undefined) ?? null;
}

/** Just the title — feeds `generateMetadata` without pulling the whole row. */
export async function getDisposalTitle(agencyId: string, id: string): Promise<string | null> {
  const rows = await sql`
    select title from public.disposals where id = ${id} and agency_id = ${agencyId} limit 1
  `;
  return (rows[0] as { title: string | null } | undefined)?.title ?? null;
}

/** Row shape for the listings-list aggregate pass. */
export type DisposalFacetRow = {
  id: string;
  city: string | null;
  postcode: string | null;
  county: string | null;
  status: string | null;
  listing_type: string;
  source: string;
};

/** The listings-list aggregate pass (unfiltered by status/town/etc — those
 *  facets are applied in memory by the caller, mirroring the original). */
/** Columns the listings-list page may sort by — a whitelist so the ORDER BY
 *  built with `sql.unsafe` below never carries anything but a known-safe
 *  identifier (the caller already constrains this via `resolveSort`'s
 *  column map, but the DAO re-validates rather than trusting it blindly). */
const FACET_SORT_COLUMNS = new Set([
  "title",
  "city",
  "use_class",
  "source",
  "size_sqft",
  "rent_pa",
  "status",
  "created_at",
]);

export async function listDisposalFacetRows(
  agencyId: string,
  opts: {
    q?: string;
    disposalType?: string;
    column:
      | "title"
      | "city"
      | "use_class"
      | "source"
      | "size_sqft"
      | "rent_pa"
      | "status"
      | "created_at";
    ascending: boolean;
  },
): Promise<DisposalFacetRow[]> {
  const term = opts.q ? ilikeTerm(opts.q) : "";
  const pattern = term ? `%${term}%` : null;
  const type = opts.disposalType || null;
  const column = FACET_SORT_COLUMNS.has(opts.column) ? opts.column : "created_at";
  const order = `${column} ${opts.ascending ? "asc" : "desc"}`;
  return (await sql`
    select id, city, postcode, county, status, listing_type, source
    from public.disposals
    where agency_id = ${agencyId}
      and (${pattern}::text is null or title ilike ${pattern} or city ilike ${pattern})
      and (${type}::text is null or disposal_type = ${type})
    order by ${sql.unsafe(order)}
  `) as DisposalFacetRow[];
}

/** Just the status column, agency-wide — feeds the dashboard's "active
 *  listings" KPI (matchability is a JS classification over free-text status,
 *  see src/lib/badges.ts's isListingMatchable, so it can't be a SQL filter). */
export async function listDisposalStatuses(
  agencyId: string,
): Promise<{ status: string | null }[]> {
  return (await sql`
    select status from public.disposals where agency_id = ${agencyId}
  `) as { status: string | null }[];
}

/** Cross-entity search hit list (id, title, city, status) — matches title,
 *  city, postcode, address line or area. Feeds /search; `pattern` must
 *  already be escapeLike-sanitized by the caller (see src/lib/search.ts). */
export async function searchDisposals(
  agencyId: string,
  pattern: string,
  limit = 10,
): Promise<{ id: string; title: string | null; city: string | null; status: string | null }[]> {
  return (await sql`
    select id, title, city, status from public.disposals
    where agency_id = ${agencyId}
      and (title ilike ${pattern} or city ilike ${pattern} or postcode ilike ${pattern}
           or address_line ilike ${pattern} or area ilike ${pattern})
    limit ${limit}
  `) as { id: string; title: string | null; city: string | null; status: string | null }[];
}

/** Status + lead agent only, agency-wide — feeds /reports's per-agent
 *  "listings" column (counts where the agent is lead and the listing is
 *  matchable). */
export async function listDisposalsForReports(
  agencyId: string,
): Promise<{ id: string; status: string | null; lead_agent_id: string | null }[]> {
  return (await sql`
    select id, status, lead_agent_id from public.disposals where agency_id = ${agencyId}
  `) as { id: string; status: string | null; lead_agent_id: string | null }[];
}

/** Row shape for the paginated table's detail pass. */
export type DisposalListRow = {
  id: string;
  title: string | null;
  city: string | null;
  use_class: string | null;
  source: string;
  size_sqft: number | null;
  rent_pa: number | null;
  premium: number | null;
  status: string | null;
  listing_type: string;
};

/** Detail pass for a specific page of ids (order re-applied by the caller). */
export async function getDisposalsByIds(
  agencyId: string,
  ids: string[],
): Promise<DisposalListRow[]> {
  if (ids.length === 0) return [];
  return (await sql`
    select id, title, city, use_class, source,
           size_sqft::float8 as size_sqft, rent_pa::float8 as rent_pa, premium::float8 as premium,
           status, listing_type
    from public.disposals
    where agency_id = ${agencyId} and id = ANY(${ids}::uuid[])
  `) as DisposalListRow[];
}

/** Feeds the company detail page's "Listings" card. */
export async function listDisposalsForCompany(
  agencyId: string,
  companyId: string,
): Promise<{ id: string; title: string | null; city: string | null; status: string | null }[]> {
  return (await sql`
    select id, title, city, status
    from public.disposals
    where agency_id = ${agencyId} and company_id = ${companyId}
    order by updated_at desc
  `) as { id: string; title: string | null; city: string | null; status: string | null }[];
}

/** Row shape used by the MatchMaker scorer (listing detail, requirement
 *  detail and /matches pages). */
export type MatchDisposal = {
  id: string;
  title: string | null;
  status: string | null;
  listing_type: string;
  city: string | null;
  area: string | null;
  postcode: string | null;
  address_line: string | null;
  county: string | null;
  lat: number | null;
  lng: number | null;
  size_sqft: number | null;
  covers_internal: number | null;
  use_class: string | null;
  property_type: string | null;
  disposal_type: string;
  rent_pa: number | null;
  premium: number | null;
  guide_price: number | null;
  fit_out_state: string | null;
};

// size_sqft/rent_pa/premium/guide_price are numeric columns; neon() returns
// numeric as JS strings, which makes the scorer's size/rent/premium/guide band
// checks compare strings lexicographically and mis-score (see MATCH_COLUMNS in
// requirements.ts). Cast to ::float8 so they arrive as real numbers, matching the
// `number | null` field types above. (lat/lng are float8, covers_internal is
// integer — already parsed as numbers.)
const MATCH_COLUMNS = `
  id, title, status, listing_type, city, area, postcode, address_line, county, lat, lng,
  size_sqft::float8 as size_sqft, covers_internal, use_class, property_type, disposal_type,
  rent_pa::float8 as rent_pa, premium::float8 as premium, guide_price::float8 as guide_price,
  fit_out_state
`;

/** Every disposal in the agency, for scoring against a requirement's criteria. */
export async function listDisposalsForMatching(agencyId: string): Promise<MatchDisposal[]> {
  return (await sql`
    select ${sql.unsafe(MATCH_COLUMNS)}
    from public.disposals
    where agency_id = ${agencyId}
  `) as MatchDisposal[];
}

/** Scoped variant of {@link listDisposalsForMatching} for a specific set of
 *  disposals — used when only a handful just changed (create/edit/re-scrape). */
export async function getDisposalsForMatchingByIds(
  agencyId: string,
  ids: string[],
): Promise<MatchDisposal[]> {
  if (ids.length === 0) return [];
  return (await sql`
    select ${sql.unsafe(MATCH_COLUMNS)}
    from public.disposals
    where agency_id = ${agencyId} and id = ANY(${ids}::uuid[])
  `) as MatchDisposal[];
}

/** Fields the disposal form writes (everything except agency_id/source/created_by). */
export type DisposalWriteInput = {
  title: string;
  listingType: string;
  status: string | null;
  disposalType: string;
  toLet: boolean;
  forSale: boolean;
  addressLine: string | null;
  area: string | null;
  city: string | null;
  postcode: string | null;
  county: string | null;
  propertyType: string | null;
  useClass: string | null;
  sizeSqft: number | null;
  sizeSqm: number | null;
  coversInternal: number | null;
  coversExternal: number | null;
  fitOutState: string | null;
  epcRating: string | null;
  tenureRaw: string | null;
  rentPa: number | null;
  premium: number | null;
  guidePrice: number | null;
  rateableValue: number | null;
  serviceCharge: number | null;
  keyFeatures: string[];
  description: string | null;
  leadAgentId: string | null;
  companyId: string | null;
  contactId: string | null;
  summary: string | null;
  locationDescription: string | null;
  licensingNotes: string | null;
  vatApplicable: boolean;
  businessRates: number | null;
  estateCharge: number | null;
  parkingCharge: number | null;
  leaseTermYears: number | null;
  leaseExpiry: string | null;
  rentReviewBasis: string | null;
  nextRentReview: number | null;
  inside1954Act: boolean;
  rentPeriod: string | null;
  priceQualifier: string | null;
  brochureUrl: string | null;
};

/**
 * `source` defaults to 'manual' (the disposal form's own listings) but is
 * overridable — the CSV bulk importer (src/lib/db/queries/import.ts) passes
 * 'import' so a spreadsheet-created row is distinguishable from a
 * hand-entered one, mirroring the original Supabase importer's
 * `source: "import"`.
 */
export async function createDisposal(
  agencyId: string,
  createdBy: string,
  input: DisposalWriteInput,
  geo: { lat: number | null; lng: number | null },
  source: string = "manual",
  /**
   * Caller-supplied identity within `source`, covered by
   * unique (agency_id, source, source_ref) from 0004. The CSV importer passes
   * the spreadsheet's `external_ref` so a re-upload updates the row it created
   * last time; left null everywhere else, and NULLs never conflict, so listings
   * without a reference stay independently insertable.
   */
  sourceRef: string | null = null,
): Promise<{ id: string }> {
  const rows = await sql`
    insert into public.disposals (
      agency_id, created_by, source, source_ref, title, listing_type, status, disposal_type,
      to_let, for_sale, address_line, area, city, postcode, county,
      property_type, use_class, size_sqft, size_sqm, covers_internal, covers_external,
      fit_out_state, epc_rating, tenure_raw, rent_pa, premium, guide_price,
      rateable_value, service_charge, key_features, description, lead_agent_id,
      company_id, contact_id, summary, location_description, licensing_notes,
      vat_applicable, business_rates, estate_charge, parking_charge, lease_term_years,
      lease_expiry, rent_review_basis, next_rent_review, inside_1954_act, rent_period,
      price_qualifier, brochure_url, lat, lng
    ) values (
      ${agencyId}, ${createdBy}, ${source}, ${sourceRef}, ${input.title}, ${input.listingType}, ${input.status}, ${input.disposalType},
      ${input.toLet}, ${input.forSale}, ${input.addressLine}, ${input.area}, ${input.city}, ${input.postcode}, ${input.county},
      ${input.propertyType}, ${input.useClass}, ${input.sizeSqft}, ${input.sizeSqm}, ${input.coversInternal}, ${input.coversExternal},
      ${input.fitOutState}, ${input.epcRating}, ${input.tenureRaw}, ${input.rentPa}, ${input.premium}, ${input.guidePrice},
      ${input.rateableValue}, ${input.serviceCharge}, ${input.keyFeatures}, ${input.description}, ${input.leadAgentId},
      ${input.companyId}, ${input.contactId}, ${input.summary}, ${input.locationDescription}, ${input.licensingNotes},
      ${input.vatApplicable}, ${input.businessRates}, ${input.estateCharge}, ${input.parkingCharge}, ${input.leaseTermYears},
      ${input.leaseExpiry}, ${input.rentReviewBasis}, ${input.nextRentReview}, ${input.inside1954Act}, ${input.rentPeriod},
      ${input.priceQualifier}, ${input.brochureUrl}, ${geo.lat}, ${geo.lng}
    )
    returning id
  `;
  return rows[0] as { id: string };
}

/**
 * Full-column upsert on the `(agency_id, source, source_ref)` unique index —
 * shared by the two places that write a scraped/imported disposal row wholesale
 * rather than through the edit form: the CDG single-URL importer
 * (src/lib/disposals/import.ts, source='cdg') and the Market Intel batch
 * resync (src/lib/db/queries/intel.ts, source=<partner id>, listingType=
 * 'intel'). ON CONFLICT DO UPDATE (not delete+insert) preserves the row's id
 * across a re-import/resync, so deals, send history and attached
 * docs/areas/contacts hanging off it survive. `row` is a `DisposalInsert`
 * (src/lib/disposals/cdg.ts) — the extractor's own row shape — so callers
 * never have to repack it into the form's `DisposalWriteInput`.
 */
export async function upsertDisposalFromSource(
  agencyId: string,
  createdBy: string | null,
  listingType: string,
  row: DisposalInsert,
): Promise<{ id: string }> {
  const rows = await sql`
    insert into public.disposals (
      agency_id, created_by, listing_type, source, source_ref, source_url, status, source_updated_at,
      title, summary, address_line, area, city, postcode, lat, lng,
      property_type, use_class, disposal_type, to_let, for_sale,
      rent_pa, rent_raw, rent_period, premium, premium_raw, guide_price, price_qualifier,
      vat_applicable, rateable_value, business_rates, service_charge, estate_charge, parking_charge,
      tenure_raw, lease_term_years, lease_expiry, rent_review_basis, next_rent_review, inside_1954_act,
      size_sqft, size_sqm, covers_internal, covers_external, floors,
      licensing_notes, fit_out_state, epc_rating,
      description, location_description, key_features, sections,
      agent_name, agent_email, agent_phone, agent_photo,
      images, brochure_url
    ) values (
      ${agencyId}, ${createdBy}, ${listingType}, ${row.source}, ${row.source_ref}, ${row.source_url}, ${row.status}, ${row.source_updated_at},
      ${row.title}, ${row.summary}, ${row.address_line}, ${row.area}, ${row.city}, ${row.postcode}, ${row.lat}, ${row.lng},
      ${row.property_type}, ${row.use_class}, ${row.disposal_type}, ${row.to_let}, ${row.for_sale},
      ${row.rent_pa}, ${row.rent_raw}, ${row.rent_period}, ${row.premium}, ${row.premium_raw}, ${row.guide_price}, ${row.price_qualifier},
      ${row.vat_applicable}, ${row.rateable_value}, ${row.business_rates}, ${row.service_charge}, ${row.estate_charge}, ${row.parking_charge},
      ${row.tenure_raw}, ${row.lease_term_years}, ${row.lease_expiry}, ${row.rent_review_basis}, ${row.next_rent_review}, ${row.inside_1954_act},
      ${row.size_sqft}, ${row.size_sqm}, ${row.covers_internal}, ${row.covers_external}, ${JSON.stringify(row.floors)}::jsonb,
      ${row.licensing_notes}, ${row.fit_out_state}, ${row.epc_rating},
      ${row.description}, ${row.location_description}, ${row.key_features}, ${JSON.stringify(row.sections)}::jsonb,
      ${row.agent_name}, ${row.agent_email}, ${row.agent_phone}, ${row.agent_photo},
      ${JSON.stringify(row.images)}::jsonb, ${row.brochure_url}
    )
    on conflict (agency_id, source, source_ref) do update set
      created_by = excluded.created_by, listing_type = excluded.listing_type,
      source_url = excluded.source_url, status = excluded.status, source_updated_at = excluded.source_updated_at,
      title = excluded.title, summary = excluded.summary, address_line = excluded.address_line, area = excluded.area,
      city = excluded.city, postcode = excluded.postcode, lat = excluded.lat, lng = excluded.lng,
      property_type = excluded.property_type, use_class = excluded.use_class, disposal_type = excluded.disposal_type,
      to_let = excluded.to_let, for_sale = excluded.for_sale,
      rent_pa = excluded.rent_pa, rent_raw = excluded.rent_raw, rent_period = excluded.rent_period,
      premium = excluded.premium, premium_raw = excluded.premium_raw, guide_price = excluded.guide_price,
      price_qualifier = excluded.price_qualifier, vat_applicable = excluded.vat_applicable,
      rateable_value = excluded.rateable_value, business_rates = excluded.business_rates,
      service_charge = excluded.service_charge, estate_charge = excluded.estate_charge, parking_charge = excluded.parking_charge,
      tenure_raw = excluded.tenure_raw, lease_term_years = excluded.lease_term_years, lease_expiry = excluded.lease_expiry,
      rent_review_basis = excluded.rent_review_basis, next_rent_review = excluded.next_rent_review,
      inside_1954_act = excluded.inside_1954_act,
      size_sqft = excluded.size_sqft, size_sqm = excluded.size_sqm, covers_internal = excluded.covers_internal,
      covers_external = excluded.covers_external, floors = excluded.floors,
      licensing_notes = excluded.licensing_notes, fit_out_state = excluded.fit_out_state, epc_rating = excluded.epc_rating,
      description = excluded.description, location_description = excluded.location_description,
      key_features = excluded.key_features, sections = excluded.sections,
      agent_name = excluded.agent_name, agent_email = excluded.agent_email, agent_phone = excluded.agent_phone,
      agent_photo = excluded.agent_photo, images = excluded.images, brochure_url = excluded.brochure_url
    returning id
  `;
  return rows[0] as { id: string };
}

/** The subset getDisposalForUpdate needs: geocode-decision fields, the
 *  optimistic-concurrency updated_at, plus source/rent/premium (drives the
 *  stale-scrape-text cleanup in the update action). */
export async function getDisposalForUpdate(
  agencyId: string,
  id: string,
): Promise<{
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  updated_at: string;
  source: string;
  rent_pa: number | null;
  rent_period: string | null;
  premium: number | null;
} | null> {
  const rows = await sql`
    select address_line, city, postcode, lat, lng, updated_at::text as updated_at,
           source, rent_pa, rent_period, premium
    from public.disposals
    where id = ${id} and agency_id = ${agencyId}
    limit 1
  `;
  return (
    (rows[0] as {
      address_line: string | null;
      city: string | null;
      postcode: string | null;
      lat: number | null;
      lng: number | null;
      updated_at: string;
      source: string;
      rent_pa: number | null;
      rent_period: string | null;
      premium: number | null;
    } | undefined) ?? null
  );
}

/**
 * Updates the row guarded by agencyId + optimistic concurrency (see
 * companies.ts's `updateCompany`). `clearRentRaw`/`clearPremiumRaw` null the
 * stale-scrape-text columns when the caller (the action) determined the
 * numeric figure they shadow just changed — see docs/employee-flow-test's
 * note on stale scraped rent; `rent_raw`/`premium_raw` reference the column's
 * pre-update value via a `CASE` so "don't clear" really means "leave
 * untouched" rather than overwriting with itself. `geo: null` means "leave
 * lat/lng untouched" (see companies.ts's `updateCompany` for the convention).
 */
export async function updateDisposal(
  agencyId: string,
  id: string,
  expectedUpdatedAt: string,
  input: DisposalWriteInput,
  flags: { clearRentRaw: boolean; clearPremiumRaw: boolean },
  geo: { lat: number | null; lng: number | null } | null,
): Promise<{ id: string } | null> {
  const rows = geo
    ? await sql`
        update public.disposals set
          title = ${input.title}, listing_type = ${input.listingType}, status = ${input.status},
          disposal_type = ${input.disposalType}, to_let = ${input.toLet}, for_sale = ${input.forSale},
          address_line = ${input.addressLine}, area = ${input.area}, city = ${input.city},
          postcode = ${input.postcode}, county = ${input.county},
          property_type = ${input.propertyType}, use_class = ${input.useClass},
          size_sqft = ${input.sizeSqft}, size_sqm = ${input.sizeSqm},
          covers_internal = ${input.coversInternal}, covers_external = ${input.coversExternal},
          fit_out_state = ${input.fitOutState}, epc_rating = ${input.epcRating},
          tenure_raw = ${input.tenureRaw}, rent_pa = ${input.rentPa}, premium = ${input.premium},
          guide_price = ${input.guidePrice}, rateable_value = ${input.rateableValue},
          service_charge = ${input.serviceCharge}, key_features = ${input.keyFeatures},
          description = ${input.description}, lead_agent_id = ${input.leadAgentId},
          company_id = ${input.companyId}, contact_id = ${input.contactId},
          summary = ${input.summary}, location_description = ${input.locationDescription},
          licensing_notes = ${input.licensingNotes}, vat_applicable = ${input.vatApplicable},
          business_rates = ${input.businessRates}, estate_charge = ${input.estateCharge},
          parking_charge = ${input.parkingCharge}, lease_term_years = ${input.leaseTermYears},
          lease_expiry = ${input.leaseExpiry}, rent_review_basis = ${input.rentReviewBasis},
          next_rent_review = ${input.nextRentReview}, inside_1954_act = ${input.inside1954Act},
          rent_period = ${input.rentPeriod}, price_qualifier = ${input.priceQualifier},
          brochure_url = ${input.brochureUrl},
          rent_raw = case when ${flags.clearRentRaw} then null else rent_raw end,
          premium_raw = case when ${flags.clearPremiumRaw} then null else premium_raw end,
          lat = ${geo.lat}, lng = ${geo.lng}
        where id = ${id} and agency_id = ${agencyId} and updated_at = ${expectedUpdatedAt}
        returning id
      `
    : await sql`
        update public.disposals set
          title = ${input.title}, listing_type = ${input.listingType}, status = ${input.status},
          disposal_type = ${input.disposalType}, to_let = ${input.toLet}, for_sale = ${input.forSale},
          address_line = ${input.addressLine}, area = ${input.area}, city = ${input.city},
          postcode = ${input.postcode}, county = ${input.county},
          property_type = ${input.propertyType}, use_class = ${input.useClass},
          size_sqft = ${input.sizeSqft}, size_sqm = ${input.sizeSqm},
          covers_internal = ${input.coversInternal}, covers_external = ${input.coversExternal},
          fit_out_state = ${input.fitOutState}, epc_rating = ${input.epcRating},
          tenure_raw = ${input.tenureRaw}, rent_pa = ${input.rentPa}, premium = ${input.premium},
          guide_price = ${input.guidePrice}, rateable_value = ${input.rateableValue},
          service_charge = ${input.serviceCharge}, key_features = ${input.keyFeatures},
          description = ${input.description}, lead_agent_id = ${input.leadAgentId},
          company_id = ${input.companyId}, contact_id = ${input.contactId},
          summary = ${input.summary}, location_description = ${input.locationDescription},
          licensing_notes = ${input.licensingNotes}, vat_applicable = ${input.vatApplicable},
          business_rates = ${input.businessRates}, estate_charge = ${input.estateCharge},
          parking_charge = ${input.parkingCharge}, lease_term_years = ${input.leaseTermYears},
          lease_expiry = ${input.leaseExpiry}, rent_review_basis = ${input.rentReviewBasis},
          next_rent_review = ${input.nextRentReview}, inside_1954_act = ${input.inside1954Act},
          rent_period = ${input.rentPeriod}, price_qualifier = ${input.priceQualifier},
          brochure_url = ${input.brochureUrl},
          rent_raw = case when ${flags.clearRentRaw} then null else rent_raw end,
          premium_raw = case when ${flags.clearPremiumRaw} then null else premium_raw end
        where id = ${id} and agency_id = ${agencyId} and updated_at = ${expectedUpdatedAt}
        returning id
      `;
  return (rows[0] as { id: string } | undefined) ?? null;
}

/** Deletes a disposal (agency-scoped) and returns the Blob URLs it owned — its
 *  document files (`disposal_documents.file_path`) and gallery images
 *  (`disposals.images[].url`) — so the caller can delete the underlying Blob
 *  objects (the FK cascade only removes the DB rows, not the storage). The
 *  caller filters to URLs we actually host before calling `del()`. */
export async function deleteDisposal(agencyId: string, id: string): Promise<string[]> {
  const urls = (await sql`
    with docs as (
      select file_path as url
      from public.disposal_documents
      where disposal_id = ${id} and agency_id = ${agencyId}
    ), imgs as (
      select (img->>'url') as url
      from public.disposals d,
           -- jsonb_array_elements throws on a non-array; guard with jsonb_typeof
           -- so a malformed images value can't abort the whole delete.
           jsonb_array_elements(
             case when jsonb_typeof(d.images) = 'array' then d.images else '[]'::jsonb end
           ) as img
      where d.id = ${id} and d.agency_id = ${agencyId}
    )
    select url from docs where url is not null
    union
    select url from imgs where url is not null
  `) as { url: string }[];
  await sql`delete from public.disposals where id = ${id} and agency_id = ${agencyId}`;
  return urls.map((r) => r.url);
}

export async function updateDisposalLeadAgent(
  agencyId: string,
  id: string,
  leadAgentId: string | null,
): Promise<boolean> {
  const rows = await sql`
    update public.disposals set lead_agent_id = ${leadAgentId}
    where id = ${id} and agency_id = ${agencyId}
    returning id
  `;
  return rows.length > 0;
}

export async function updateDisposalStatusOnly(
  agencyId: string,
  id: string,
  status: string,
): Promise<boolean> {
  const rows = await sql`
    update public.disposals set status = ${status}
    where id = ${id} and agency_id = ${agencyId}
    returning id
  `;
  return rows.length > 0;
}

/** Bulk status change from the listings table's floating select bar. Returns
 *  the number of rows updated. */
export async function bulkUpdateDisposalStatus(
  agencyId: string,
  ids: string[],
  status: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await sql`
    update public.disposals set status = ${status}
    where agency_id = ${agencyId} and id = ANY(${ids}::uuid[])
    returning id
  `;
  return rows.length;
}

/** Bulk lead-agent assignment from the listings table's floating select bar.
 *  Returns the number of rows updated. */
export async function bulkAssignDisposalLead(
  agencyId: string,
  ids: string[],
  leadAgentId: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await sql`
    update public.disposals set lead_agent_id = ${leadAgentId}
    where agency_id = ${agencyId} and id = ANY(${ids}::uuid[])
    returning id
  `;
  return rows.length;
}

/** Additional-agent (collaborator) user ids for a disposal. */
export async function getDisposalAgentIds(agencyId: string, disposalId: string): Promise<string[]> {
  const rows = await sql`
    select user_id from public.disposal_agents
    where agency_id = ${agencyId} and disposal_id = ${disposalId}
  `;
  return (rows as { user_id: string }[]).map((r) => r.user_id);
}

/** Replaces a disposal's additional-agent rows — see companies.ts's
 *  `syncCompanyAgents` for the delete+unnest-insert pattern. */
export async function syncDisposalAgents(
  agencyId: string,
  disposalId: string,
  userIds: string[],
): Promise<void> {
  await sql.transaction((tx) => [
    tx`delete from public.disposal_agents where agency_id = ${agencyId} and disposal_id = ${disposalId}`,
    tx`
      insert into public.disposal_agents (agency_id, disposal_id, user_id)
      select ${agencyId}, ${disposalId}, u from unnest(${userIds}::uuid[]) as u
    `,
  ]);
}

// ── Available-area schedule (disposal_areas) ────────────────────────────────

export type DisposalArea = {
  id: string;
  name: string;
  size_sqft: number | null;
  size_sqm: number | null;
  rent_pa: number | null;
  availability: string | null;
};

export async function listDisposalAreas(
  agencyId: string,
  disposalId: string,
): Promise<DisposalArea[]> {
  return (await sql`
    select id, name, size_sqft::float8 as size_sqft, size_sqm::float8 as size_sqm,
           rent_pa::float8 as rent_pa, availability
    from public.disposal_areas
    where agency_id = ${agencyId} and disposal_id = ${disposalId}
    order by sort_order, created_at
  `) as DisposalArea[];
}

export async function addDisposalArea(
  agencyId: string,
  disposalId: string,
  input: {
    name: string;
    sizeSqft: number | null;
    sizeSqm: number | null;
    rentPa: number | null;
    availability: string | null;
    sortOrder: number;
  },
): Promise<void> {
  // Guard the insert on the parent disposal belonging to this agency, so a
  // client-supplied disposal_id owned by another agency can't create an orphan
  // area row (no RLS backstop — see AGENTS.md).
  await sql`
    insert into public.disposal_areas (agency_id, disposal_id, name, size_sqft, size_sqm, rent_pa, availability, sort_order)
    select ${agencyId}, ${disposalId}, ${input.name}, ${input.sizeSqft}, ${input.sizeSqm}, ${input.rentPa}, ${input.availability}, ${input.sortOrder}
    where exists (select 1 from public.disposals where id = ${disposalId} and agency_id = ${agencyId})
  `;
}

export async function deleteDisposalArea(agencyId: string, id: string): Promise<void> {
  await sql`delete from public.disposal_areas where id = ${id} and agency_id = ${agencyId}`;
}

// ── disposal images (the `disposals.images` jsonb column) ──────────────────
// Storage itself (Vercel Blob upload/delete) lives in src/lib/actions/disposal-images.ts
// and src/lib/disposals/storage.ts; these two just read/write the jsonb array
// that records each image's `{url, alt, source_url}`.

/** Current `images` array for a disposal, or `undefined` if no row matches
 *  (agency-scoped) — distinct from a found-but-empty array (`[]`, the
 *  column's own default), so callers can tell "doesn't exist" apart from
 *  "exists with no photos yet". */
export async function getDisposalImages(
  agencyId: string,
  id: string,
): Promise<unknown> {
  const rows = await sql`
    select images from public.disposals where id = ${id} and agency_id = ${agencyId} limit 1
  `;
  if (rows.length === 0) return undefined;
  return (rows[0] as { images: unknown }).images;
}

export async function updateDisposalImages(
  agencyId: string,
  id: string,
  images: unknown,
): Promise<void> {
  await sql`
    update public.disposals set images = ${JSON.stringify(images)}::jsonb
    where id = ${id} and agency_id = ${agencyId}
  `;
}

// ── disposal_documents — vendor/floor-plan PDFs, one row per uploaded file.
//    The file itself lives in Vercel Blob (private-by-convention: no public
//    Blob URL is ever handed to the browser directly — see
//    src/lib/disposal-docs.ts's signed-proxy scheme and
//    src/app/api/disposal-docs/[id]/route.ts). ───────────────────────────────

export type DisposalDocumentRow = {
  id: string;
  name: string;
  doc_type: string;
  size_bytes: number | null;
  file_path: string;
};

export async function listDisposalDocuments(
  agencyId: string,
  disposalId: string,
): Promise<DisposalDocumentRow[]> {
  return (await sql`
    select id, name, doc_type, size_bytes::float8 as size_bytes, file_path
    from public.disposal_documents
    where agency_id = ${agencyId} and disposal_id = ${disposalId}
    order by created_at
  `) as DisposalDocumentRow[];
}

/** Single-document lookup, agency-scoped — the authorization boundary for a
 *  document download (see disposal-docs.ts's `authorizeDisposalDocument` /
 *  `signDisposalDocUrl`). Returns null for both "no such document" and
 *  "belongs to another agency" — the two cases are deliberately
 *  indistinguishable to the caller so a cross-tenant probe can't be used to
 *  learn whether an id exists. */
export async function getDisposalDocumentById(
  agencyId: string,
  id: string,
): Promise<DisposalDocumentRow | null> {
  const rows = await sql`
    select id, name, doc_type, size_bytes::float8 as size_bytes, file_path
    from public.disposal_documents
    where id = ${id} and agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as DisposalDocumentRow | undefined) ?? null;
}

/**
 * Unscoped by agency — safe ONLY because the caller already proved
 * authorization some other way. The one legitimate caller is the
 * `/api/disposal-docs/[id]` route's signed-token path: the HMAC signature
 * embedded in that URL can only have been minted by `signDisposalDocUrl`
 * (disposal-docs.ts), which already did the agency-scoped check once, at
 * sign time — re-checking here would need an agencyId the token path
 * doesn't have. Never call this anywhere that hasn't independently verified
 * access first.
 */
export async function getDisposalDocumentByIdUnsafe(
  id: string,
): Promise<DisposalDocumentRow | null> {
  const rows = await sql`
    select id, name, doc_type, size_bytes::float8 as size_bytes, file_path
    from public.disposal_documents
    where id = ${id}
    limit 1
  `;
  return (rows[0] as DisposalDocumentRow | undefined) ?? null;
}

export async function addDisposalDocumentRow(
  agencyId: string,
  disposalId: string,
  uploadedBy: string,
  input: { name: string; docType: string; filePath: string; sizeBytes: number | null },
): Promise<{ id: string }> {
  const rows = await sql`
    insert into public.disposal_documents (agency_id, disposal_id, name, doc_type, file_path, size_bytes, uploaded_by)
    values (${agencyId}, ${disposalId}, ${input.name}, ${input.docType}, ${input.filePath}, ${input.sizeBytes}, ${uploadedBy})
    returning id
  `;
  return rows[0] as { id: string };
}

/** Deletes the metadata row scoped to the caller's agency FIRST; the caller
 *  only removes the underlying Blob object if a row it actually owned came
 *  back (`file_path` non-null) — never touches another agency's file. */
export async function deleteDisposalDocumentRow(
  agencyId: string,
  id: string,
): Promise<{ file_path: string } | null> {
  const rows = await sql`
    delete from public.disposal_documents
    where id = ${id} and agency_id = ${agencyId}
    returning file_path
  `;
  return (rows[0] as { file_path: string } | undefined) ?? null;
}

// ── Small cross-table lookups the listing detail page + particulars PDF
//    need. Kept here (rather than in companies.ts/contacts.ts/agencies.ts,
//    which are out of scope for this batch — see AGENTS.md) since these are
//    one-off reads specific to rendering a disposal record. ────────────────

/** True if `userId` is a member (any role) of `agencyId` — validates a bulk
 *  lead-agent assignment target before writing it. */
export async function isAgencyMember(agencyId: string, userId: string): Promise<boolean> {
  const rows = await sql`
    select 1 from public.agency_members
    where agency_id = ${agencyId} and user_id = ${userId}
    limit 1
  `;
  return rows.length > 0;
}

export type UserProfile = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  linkedin_url: string | null;
  x_url: string | null;
};

/** The lead agent's contact-card fields for the "Lead agent" panel — reads
 *  `public.users` directly (the merged profiles+auth.users table; see
 *  db/migrations/0001_init.sql) since there's no `profiles` table anymore. */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const rows = await sql`
    select id, full_name, email, phone, avatar_url, linkedin_url, x_url
    from public.users
    where id = ${userId}
    limit 1
  `;
  return (rows[0] as UserProfile | undefined) ?? null;
}

/** Several users' names/emails in one round trip — feeds the particulars PDF's
 *  "internal team assigned" line (lead first, then collaborators). */
export async function getUserNames(
  userIds: string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = (await sql`
    select id, full_name, email from public.users where id = ANY(${userIds}::uuid[])
  `) as { id: string; full_name: string | null; email: string }[];
  return new Map(rows.map((r) => [r.id, r.full_name ?? r.email ?? "Agent"]));
}

export type LinkedCompany = { id: string; name: string; type: string };
export type LinkedContact = {
  id: string;
  first_name: string;
  last_name: string | null;
  role: string;
  email: string | null;
  phone: string | null;
};

/** The linked landlord/vendor company for #4's "Company & contact" card. */
export async function getLinkedCompany(
  agencyId: string,
  companyId: string,
): Promise<LinkedCompany | null> {
  const rows = await sql`
    select id, name, type from public.companies
    where id = ${companyId} and agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as LinkedCompany | undefined) ?? null;
}

/** The linked point-of-contact for #4's "Company & contact" card. */
export async function getLinkedContact(
  agencyId: string,
  contactId: string,
): Promise<LinkedContact | null> {
  const rows = await sql`
    select id, first_name, last_name, role, email, phone from public.contacts
    where id = ${contactId} and agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as LinkedContact | undefined) ?? null;
}
