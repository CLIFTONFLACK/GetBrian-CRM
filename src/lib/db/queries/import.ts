import { sql } from "@/lib/db/client";
import { contactNameKey } from "@/lib/import-matching";

// DAO for the bulk CSV importer (src/lib/actions/import-data.ts): the lookups
// that decide whether a spreadsheet row is a new record or an existing one, and
// the blank-preserving updates applied when it is existing.
//
// Row *inserts* reuse each domain's existing create* function
// (createCompany/createContact/createRequirement/createDisposal) rather than
// duplicating insert logic here — see AGENTS.md. Updates can't do the same: the
// domain update* functions take a complete write input plus an
// optimistic-concurrency timestamp, which would overwrite every column the
// spreadsheet happens not to carry. See the note on blank preservation below.
//
// Every function takes the caller's agencyId as a mandatory first parameter and
// filters on it explicitly — see the same note in companies.ts.

// ─────────────────────────────────────────────────────────────────────────────
// Blank preservation
// ─────────────────────────────────────────────────────────────────────────────
// An import update writes only the columns the file actually supplied. A column
// the spreadsheet omits — or leaves blank — keeps whatever the record already
// holds, so uploading a partial file (say, just new phone numbers) tops records
// up instead of wiping their notes, addresses and agent assignments.
//
// That is expressed as `coalesce(${value}, column)`: the importer passes null
// for "not supplied", and the existing value survives. It keeps the SQL static —
// this codebase has no dynamic query builder, and the neon HTTP driver's tagged
// template can't assemble a variable SET list safely.
//
// The consequence to be aware of: a blank cell cannot CLEAR a field. That is the
// deliberate trade — clearing is done in the UI, where it is one record at a
// time and visible.

/** Every contact's email → id, lower-cased, for the importer's
 *  `contact_email` column resolution and for matching contact rows to
 *  existing records. */
export async function listContactEmailMap(agencyId: string): Promise<Map<string, string>> {
  const rows = (await sql`
    select id, email from public.contacts
    where agency_id = ${agencyId} and email is not null
  `) as { id: string; email: string }[];
  return new Map(rows.map((r) => [r.email.trim().toLowerCase(), r.id]));
}

/** Every company's name → id, lower-cased — the fallback company match key,
 *  and how contacts' `company_name` links resolve. */
export async function listCompanyNameMap(agencyId: string): Promise<Map<string, string>> {
  const rows = (await sql`
    select id, name from public.companies where agency_id = ${agencyId}
  `) as { id: string; name: string }[];
  return new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.id]));
}

/** Company registration number → id, lower-cased. The strong company match
 *  key: a company can be renamed and still be the same company. */
export async function listCompanyNumberMap(agencyId: string): Promise<Map<string, string>> {
  const rows = (await sql`
    select id, company_number from public.companies
    where agency_id = ${agencyId} and company_number is not null and company_number <> ''
  `) as { id: string; company_number: string }[];
  return new Map(rows.map((r) => [r.company_number.trim().toLowerCase(), r.id]));
}

/** Contact name key → id, for spreadsheets that carry no email address.
 *  Ambiguous keys (two contacts genuinely sharing a name at one company) are
 *  dropped rather than guessed at — the importer then inserts, which is the
 *  safe direction: a duplicate is visible and fixable, a wrongly overwritten
 *  record is not. */
export async function listContactNameMap(agencyId: string): Promise<Map<string, string>> {
  const rows = (await sql`
    select id, first_name, last_name, company_id from public.contacts
    where agency_id = ${agencyId}
  `) as {
    id: string;
    first_name: string;
    last_name: string | null;
    company_id: string | null;
  }[];
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const r of rows) {
    const key = contactNameKey(r.first_name, r.last_name, r.company_id);
    if (map.has(key)) ambiguous.add(key);
    else map.set(key, r.id);
  }
  for (const key of ambiguous) map.delete(key);
  return map;
}

/** Requirement import reference → id (see db/migrations/0036). */
export async function listRequirementRefMap(agencyId: string): Promise<Map<string, string>> {
  const rows = (await sql`
    select id, external_ref from public.requirements
    where agency_id = ${agencyId} and external_ref is not null and external_ref <> ''
  `) as { id: string; external_ref: string }[];
  return new Map(rows.map((r) => [r.external_ref.trim().toLowerCase(), r.id]));
}

/** Imported listings' source_ref → id. Scoped to source = 'import' so a CSV
 *  reference can never collide with a scraped listing's own reference (the
 *  unique index is on (agency_id, source, source_ref), and the two sources are
 *  separate namespaces). */
export async function listDisposalRefMap(agencyId: string): Promise<Map<string, string>> {
  const rows = (await sql`
    select id, source_ref from public.disposals
    where agency_id = ${agencyId} and source = 'import'
      and source_ref is not null and source_ref <> ''
  `) as { id: string; source_ref: string }[];
  return new Map(rows.map((r) => [r.source_ref.trim().toLowerCase(), r.id]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Blank-preserving updates
// ─────────────────────────────────────────────────────────────────────────────
// Each patch field is `T | null`, where null means "the file didn't supply
// this — leave it alone". Note this differs from the domain write inputs, where
// null means "set to null".

export type CompanyImportPatch = {
  name: string | null;
  type: string | null;
  sectorTags: string[] | null;
  website: string | null;
  phone: string | null;
  notes: string | null;
  companyNumber: string | null;
  vatNumber: string | null;
  addressLine: string | null;
  city: string | null;
  postcode: string | null;
  county: string | null;
  lat: number | null;
  lng: number | null;
};

export async function updateCompanyFromImport(
  agencyId: string,
  id: string,
  p: CompanyImportPatch,
): Promise<void> {
  await sql`
    update public.companies set
      name           = coalesce(${p.name}, name),
      type           = coalesce(${p.type}, type),
      sector_tags    = coalesce(${p.sectorTags}, sector_tags),
      website        = coalesce(${p.website}, website),
      phone          = coalesce(${p.phone}, phone),
      notes          = coalesce(${p.notes}, notes),
      company_number = coalesce(${p.companyNumber}, company_number),
      vat_number     = coalesce(${p.vatNumber}, vat_number),
      address_line   = coalesce(${p.addressLine}, address_line),
      city           = coalesce(${p.city}, city),
      postcode       = coalesce(${p.postcode}, postcode),
      county         = coalesce(${p.county}, county),
      lat            = coalesce(${p.lat}, lat),
      lng            = coalesce(${p.lng}, lng)
    where id = ${id} and agency_id = ${agencyId}
  `;
}

export type ContactImportPatch = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  companyId: string | null;
  notes: string | null;
  /** Only ever true — a blank cell must not silently opt someone out. */
  marketingOptIn: boolean | null;
  addressLine: string | null;
  city: string | null;
  postcode: string | null;
  county: string | null;
  lat: number | null;
  lng: number | null;
};

export async function updateContactFromImport(
  agencyId: string,
  id: string,
  p: ContactImportPatch,
): Promise<void> {
  await sql`
    update public.contacts set
      first_name        = coalesce(${p.firstName}, first_name),
      last_name         = coalesce(${p.lastName}, last_name),
      email             = coalesce(${p.email}, email),
      phone             = coalesce(${p.phone}, phone),
      role              = coalesce(${p.role}, role),
      company_id        = coalesce(${p.companyId}::uuid, company_id),
      notes             = coalesce(${p.notes}, notes),
      marketing_opt_in  = coalesce(${p.marketingOptIn}, marketing_opt_in),
      address_line      = coalesce(${p.addressLine}, address_line),
      city              = coalesce(${p.city}, city),
      postcode          = coalesce(${p.postcode}, postcode),
      county            = coalesce(${p.county}, county),
      lat               = coalesce(${p.lat}, lat),
      lng               = coalesce(${p.lng}, lng)
    where id = ${id} and agency_id = ${agencyId}
  `;
}

export type RequirementImportPatch = {
  title: string | null;
  companyId: string | null;
  contactId: string | null;
  status: string | null;
  targetTowns: string[] | null;
  targetRegions: string[] | null;
  targetCounties: string[] | null;
  targetPostcodeDistricts: string[] | null;
  targetNeighbourhoods: string[] | null;
  targetLondonZones: string[] | null;
  useClasses: string[] | null;
  tenurePrefs: string[] | null;
  minSqft: number | null;
  maxSqft: number | null;
  minCovers: number | null;
  maxCovers: number | null;
  maxRent: number | null;
  maxPremium: number | null;
  maxGuidePrice: number | null;
  notes: string | null;
};

export async function updateRequirementFromImport(
  agencyId: string,
  id: string,
  p: RequirementImportPatch,
): Promise<void> {
  await sql`
    update public.requirements set
      title                      = coalesce(${p.title}, title),
      company_id                 = coalesce(${p.companyId}::uuid, company_id),
      contact_id                 = coalesce(${p.contactId}::uuid, contact_id),
      status                     = coalesce(${p.status}::public.requirement_status, status),
      target_towns               = coalesce(${p.targetTowns}, target_towns),
      target_regions             = coalesce(${p.targetRegions}, target_regions),
      target_counties            = coalesce(${p.targetCounties}, target_counties),
      target_postcode_districts  = coalesce(${p.targetPostcodeDistricts}, target_postcode_districts),
      target_neighbourhoods      = coalesce(${p.targetNeighbourhoods}, target_neighbourhoods),
      target_london_zones        = coalesce(${p.targetLondonZones}, target_london_zones),
      use_classes                = coalesce(${p.useClasses}::public.use_class[], use_classes),
      tenure_prefs               = coalesce(${p.tenurePrefs}::public.tenure_type[], tenure_prefs),
      min_sqft                   = coalesce(${p.minSqft}, min_sqft),
      max_sqft                   = coalesce(${p.maxSqft}, max_sqft),
      min_covers                 = coalesce(${p.minCovers}, min_covers),
      max_covers                 = coalesce(${p.maxCovers}, max_covers),
      max_rent                   = coalesce(${p.maxRent}, max_rent),
      max_premium                = coalesce(${p.maxPremium}, max_premium),
      max_guide_price            = coalesce(${p.maxGuidePrice}, max_guide_price),
      notes                      = coalesce(${p.notes}, notes)
    where id = ${id} and agency_id = ${agencyId}
  `;
}

export type DisposalImportPatch = {
  title: string | null;
  contactId: string | null;
  listingType: string | null;
  status: string | null;
  disposalType: string | null;
  addressLine: string | null;
  area: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
  propertyType: string | null;
  useClass: string | null;
  sizeSqft: number | null;
  coversInternal: number | null;
  rentPa: number | null;
  premium: number | null;
  guidePrice: number | null;
  description: string | null;
};

export async function updateDisposalFromImport(
  agencyId: string,
  id: string,
  p: DisposalImportPatch,
): Promise<void> {
  await sql`
    update public.disposals set
      title           = coalesce(${p.title}, title),
      contact_id      = coalesce(${p.contactId}::uuid, contact_id),
      listing_type    = coalesce(${p.listingType}, listing_type),
      status          = coalesce(${p.status}, status),
      disposal_type   = coalesce(${p.disposalType}, disposal_type),
      address_line    = coalesce(${p.addressLine}, address_line),
      area            = coalesce(${p.area}, area),
      city            = coalesce(${p.city}, city),
      county          = coalesce(${p.county}, county),
      postcode        = coalesce(${p.postcode}, postcode),
      property_type   = coalesce(${p.propertyType}, property_type),
      use_class       = coalesce(${p.useClass}, use_class),
      size_sqft       = coalesce(${p.sizeSqft}, size_sqft),
      covers_internal = coalesce(${p.coversInternal}, covers_internal),
      rent_pa         = coalesce(${p.rentPa}, rent_pa),
      premium         = coalesce(${p.premium}, premium),
      guide_price     = coalesce(${p.guidePrice}, guide_price),
      description     = coalesce(${p.description}, description)
    where id = ${id} and agency_id = ${agencyId}
  `;
}
