import { sql } from "@/lib/db/client";
import { contactNameKey } from "@/lib/import-matching";
import { addressChanged, type StoredAddress } from "@/lib/import-followup";
import { mergeNotes, unionTags, type ExistingRequirement } from "@/lib/import-parse";

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

// ─────────────────────────────────────────────────────────────────────────────
// Notes never overwrite, and the source date is exact
// ─────────────────────────────────────────────────────────────────────────────
// Notes: an import update reads the stored notes and combines them with
// mergeNotes() (empty -> set, already contained -> unchanged, else appended as a
// new paragraph). It returns null when nothing would change, which the update
// then passes as "not supplied".
//
// date_updated: the 0044 trigger sets date_updated = now() on any real change
// unless the statement moved date_updated itself — and it cannot tell "not
// supplied" from "supplied, but equal to the stored value". So when the file
// carried a date, a SECOND statement in the same transaction pins the row to
// exactly that date. That statement changes only date_updated, which the
// trigger keeps without moving updated_at (the edit forms' lock token).

type ImportTable = "companies" | "contacts" | "requirements";

/** What the importer read about a row just before updating it. */
type Current = {
  notes: string | null;
  /** date_updated as epoch milliseconds. */
  dateMs: number;
  sectorTags: string[] | null;
  optIn: boolean | null;
  alerts: boolean | null;
};

const ISO_UTC = `YYYY-MM-DD"T"HH24:MI:SS.MS"Z"`;

async function readCurrent(
  table: ImportTable,
  id: string,
  agencyId: string,
): Promise<Current | null> {
  const rows = (
    table === "companies"
      ? await sql`select notes, sector_tags, to_char(date_updated at time zone 'UTC', ${ISO_UTC}::text) as d
          from public.companies where id = ${id} and agency_id = ${agencyId}`
      : table === "contacts"
        ? await sql`select notes, marketing_opt_in, marketing_property_alerts,
            to_char(date_updated at time zone 'UTC', ${ISO_UTC}::text) as d
            from public.contacts where id = ${id} and agency_id = ${agencyId}`
        : await sql`select notes, to_char(date_updated at time zone 'UTC', ${ISO_UTC}::text) as d
            from public.requirements where id = ${id} and agency_id = ${agencyId}`
  ) as Record<string, unknown>[];
  const r = rows[0];
  if (!r) return null;
  return {
    notes: (r.notes as string | null) ?? null,
    dateMs: Date.parse(String(r.d)),
    sectorTags: (r.sector_tags as string[] | null | undefined) ?? null,
    optIn: (r.marketing_opt_in as boolean | null | undefined) ?? null,
    alerts: (r.marketing_property_alerts as boolean | null | undefined) ?? null,
  };
}

/** The notes to write, or null when the incoming notes change nothing. */
function notesToWrite(stored: string | null, incoming: string | null): string | null {
  if (!incoming || !incoming.trim()) return null;
  const merged = mergeNotes(stored, incoming);
  return merged === (stored ?? "") ? null : merged;
}

export type ImportUpdateResult = {
  /** Notes changed under us twice; everything else was saved, notes were not. */
  notesConflict: boolean;
  /** The file said Yes to a marketing flag the stored record has as No. */
  consentBlocked: boolean;
};

type ExecArgs = {
  cur: Current;
  /** Notes to write, or null for "leave alone". */
  notes: string | null;
  /** True when `notes` must still equal what was read (a changed-under-us check). */
  guarded: boolean;
  /** True when the source date should end up on the row. */
  applyDate: boolean;
};

/**
 * Read, decide, write — with the notes write guarded by what was read. If the
 * guarded update matched no row because the notes changed meanwhile, read again
 * and retry once; if that fails too, save everything except the notes and say
 * so. The source date is applied only when it is not older than the stored
 * date_updated that was read, so an import never moves a record backwards past
 * work done in the CRM.
 */
async function guardedUpdate(
  table: ImportTable,
  id: string,
  agencyId: string,
  incomingNotes: string | null,
  sourceDate: string | null,
  exec: (a: ExecArgs) => Promise<boolean>,
): Promise<{ notesConflict: boolean; cur: Current | null }> {
  const plan = (cur: Current): ExecArgs => {
    const notes = notesToWrite(cur.notes, incomingNotes);
    return {
      cur,
      notes,
      guarded: notes !== null,
      applyDate: sourceDate !== null && Date.parse(sourceDate) >= cur.dateMs,
    };
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await readCurrent(table, id, agencyId);
    if (!cur) return { notesConflict: false, cur: null };
    const args = plan(cur);
    const ok = await exec(args);
    if (ok || !args.guarded) return { notesConflict: false, cur };
  }
  const cur = await readCurrent(table, id, agencyId);
  if (!cur) return { notesConflict: false, cur: null };
  await exec({ ...plan(cur), notes: null, guarded: false });
  return { notesConflict: true, cur };
}

/** Pin a freshly created row to the file's date (create* leaves it at now()). */
export async function setImportedDateUpdated(
  table: ImportTable,
  id: string,
  agencyId: string,
  iso: string | null,
): Promise<void> {
  if (!iso) return;
  if (table === "companies") {
    await sql`update public.companies set date_updated = ${iso}::timestamptz
      where id = ${id} and agency_id = ${agencyId} and date_updated is distinct from ${iso}::timestamptz`;
  } else if (table === "contacts") {
    await sql`update public.contacts set date_updated = ${iso}::timestamptz
      where id = ${id} and agency_id = ${agencyId} and date_updated is distinct from ${iso}::timestamptz`;
  } else {
    await sql`update public.requirements set date_updated = ${iso}::timestamptz
      where id = ${id} and agency_id = ${agencyId} and date_updated is distinct from ${iso}::timestamptz`;
  }
}

/** Contact id → date_updated (ISO), for requirements that carry no date of their own. */
export async function listContactDateMap(agencyId: string): Promise<Map<string, string>> {
  const rows = (await sql`
    select id, to_char(date_updated at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as d
    from public.contacts where agency_id = ${agencyId}
  `) as { id: string; d: string }[];
  return new Map(rows.map((r) => [r.id, r.d]));
}

/** Every stored requirement's identity (title, contact, company), for matching
 *  a changed row in a file with no ID column to the requirement it came from. */
export async function listRequirementIdentities(
  agencyId: string,
): Promise<ExistingRequirement[]> {
  const rows = (await sql`
    select id, title, contact_id, company_id, external_ref from public.requirements
    where agency_id = ${agencyId}
  `) as {
    id: string;
    title: string;
    contact_id: string | null;
    company_id: string | null;
    external_ref: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    contactId: r.contact_id,
    companyId: r.company_id,
    externalRef: r.external_ref,
  }));
}

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
  /** ISO instant from the file's Date Updated column; null = not supplied. */
  dateUpdated: string | null;
};

export async function updateCompanyFromImport(
  agencyId: string,
  id: string,
  p: CompanyImportPatch,
): Promise<ImportUpdateResult> {
  const r = await guardedUpdate(
    "companies",
    id,
    agencyId,
    p.notes,
    p.dateUpdated,
    async ({ cur, notes, guarded, applyDate }) => {
      // Tags merge with the stored ones (stored order first); they never replace.
      const tags = p.sectorTags ? unionTags(cur.sectorTags, p.sectorTags) : null;
      const out = (await sql.transaction((tx) => [
        tx`
    update public.companies set
      name           = coalesce(${p.name}, name),
      type           = coalesce(${p.type}, type),
      sector_tags    = coalesce(${tags}, sector_tags),
      website        = coalesce(${p.website}, website),
      phone          = coalesce(${p.phone}, phone),
      notes          = coalesce(${notes}, notes),
      company_number = coalesce(${p.companyNumber}, company_number),
      vat_number     = coalesce(${p.vatNumber}, vat_number),
      address_line   = coalesce(${p.addressLine}, address_line),
      city           = coalesce(${p.city}, city),
      postcode       = coalesce(${p.postcode}, postcode),
      county         = coalesce(${p.county}, county),
      lat            = coalesce(${p.lat}, lat),
      lng            = coalesce(${p.lng}, lng)
    where id = ${id} and agency_id = ${agencyId}
      and (${guarded}::boolean = false or notes is not distinct from ${cur.notes}::text)
    returning id
  `,
        ...(applyDate && p.dateUpdated
          ? [
              tx`update public.companies set date_updated = ${p.dateUpdated}::timestamptz
                 where id = ${id} and agency_id = ${agencyId}
                   and date_updated is distinct from ${p.dateUpdated}::timestamptz`,
            ]
          : []),
      ])) as unknown as unknown[][];
      return out[0].length > 0;
    },
  );
  return { notesConflict: r.notesConflict, consentBlocked: false };
}

export type ContactImportPatch = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  role: string | null;
  companyId: string | null;
  notes: string | null;
  /** Only ever true — a blank cell must not silently opt someone out. */
  marketingOptIn: boolean | null;
  /** Same rule as marketingOptIn. */
  marketingPropertyAlerts: boolean | null;
  addressLine: string | null;
  city: string | null;
  postcode: string | null;
  county: string | null;
  lat: number | null;
  lng: number | null;
  dateUpdated: string | null;
};

export async function updateContactFromImport(
  agencyId: string,
  id: string,
  p: ContactImportPatch,
): Promise<ImportUpdateResult> {
  const r = await guardedUpdate(
    "contacts",
    id,
    agencyId,
    p.notes,
    p.dateUpdated,
    async ({ cur, notes, guarded, applyDate }) => {
      // Consent only ever moves from "not recorded" to yes. A stored No stays No.
      const out = (await sql.transaction((tx) => [
        tx`
    update public.contacts set
      first_name        = coalesce(${p.firstName}, first_name),
      last_name         = coalesce(${p.lastName}, last_name),
      email             = coalesce(${p.email}, email),
      phone             = coalesce(${p.phone}, phone),
      mobile            = coalesce(${p.mobile}, mobile),
      role              = coalesce(${p.role}, role),
      company_id        = coalesce(${p.companyId}::uuid, company_id),
      notes             = coalesce(${notes}, notes),
      marketing_opt_in  = case when ${p.marketingOptIn}::boolean is true and marketing_opt_in is null
                               then true else marketing_opt_in end,
      marketing_property_alerts = case when ${p.marketingPropertyAlerts}::boolean is true
                                        and marketing_property_alerts is null
                                       then true else marketing_property_alerts end,
      address_line      = coalesce(${p.addressLine}, address_line),
      city              = coalesce(${p.city}, city),
      postcode          = coalesce(${p.postcode}, postcode),
      county            = coalesce(${p.county}, county),
      lat               = coalesce(${p.lat}, lat),
      lng               = coalesce(${p.lng}, lng)
    where id = ${id} and agency_id = ${agencyId}
      and (${guarded}::boolean = false or notes is not distinct from ${cur.notes}::text)
    returning id
  `,
        ...(applyDate && p.dateUpdated
          ? [
              tx`update public.contacts set date_updated = ${p.dateUpdated}::timestamptz
                 where id = ${id} and agency_id = ${agencyId}
                   and date_updated is distinct from ${p.dateUpdated}::timestamptz`,
            ]
          : []),
      ])) as unknown as unknown[][];
      return out[0].length > 0;
    },
  );
  const cur = r.cur;
  const consentBlocked =
    cur !== null &&
    ((p.marketingOptIn === true && cur.optIn === false) ||
      (p.marketingPropertyAlerts === true && cur.alerts === false));
  return { notesConflict: r.notesConflict, consentBlocked };
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
  dateUpdated: string | null;
  /** Set only when a changed row is "adopted": the stored requirement takes the new reference. */
  externalRef: string | null;
};

export async function updateRequirementFromImport(
  agencyId: string,
  id: string,
  p: RequirementImportPatch,
): Promise<ImportUpdateResult> {
  const r = await guardedUpdate(
    "requirements",
    id,
    agencyId,
    p.notes,
    p.dateUpdated,
    async ({ cur, notes, guarded, applyDate }) => {
      const out = (await sql.transaction((tx) => [
        tx`
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
      external_ref               = case when external_ref is null or external_ref like 'kato-%'
                                        then coalesce(${p.externalRef}, external_ref)
                                        else external_ref end,
      notes                      = coalesce(${notes}, notes)
    where id = ${id} and agency_id = ${agencyId}
      and (${guarded}::boolean = false or notes is not distinct from ${cur.notes}::text)
    returning id
  `,
        ...(applyDate && p.dateUpdated
          ? [
              tx`update public.requirements set date_updated = ${p.dateUpdated}::timestamptz
                 where id = ${id} and agency_id = ${agencyId}
                   and date_updated is distinct from ${p.dateUpdated}::timestamptz`,
            ]
          : []),
      ])) as unknown as unknown[][];
      return out[0].length > 0;
    },
  );
  return { notesConflict: r.notesConflict, consentBlocked: false };
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
  // A changed address makes the stored coordinates wrong: clear them in the same
  // UPDATE so the follow-up geocodes the row. Blank or unchanged cells leave
  // them alone.
  const stored = (
    (await sql`
      select address_line, area, city, county, postcode from public.disposals
      where id = ${id} and agency_id = ${agencyId}
    `) as StoredAddress[]
  )[0];
  const moved = stored
    ? addressChanged(stored, {
        address_line: p.addressLine,
        area: p.area,
        city: p.city,
        county: p.county,
        postcode: p.postcode,
      })
    : false;
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
      description     = coalesce(${p.description}, description),
      lat             = case when ${moved}::boolean then null else lat end,
      lng             = case when ${moved}::boolean then null else lng end
    where id = ${id} and agency_id = ${agencyId}
  `;
}

/** Contact id -> stored marketing flags, for the dry run's consent count. */
export async function listContactConsent(
  agencyId: string,
): Promise<Map<string, { optIn: boolean | null; alerts: boolean | null }>> {
  const rows = (await sql`
    select id, marketing_opt_in, marketing_property_alerts
    from public.contacts where agency_id = ${agencyId}
  `) as { id: string; marketing_opt_in: boolean | null; marketing_property_alerts: boolean | null }[];
  return new Map(
    rows.map((r) => [r.id, { optIn: r.marketing_opt_in, alerts: r.marketing_property_alerts }]),
  );
}

/** What the listings follow-up needs to know about the rows an import wrote:
 *  status (live or not), whether coordinates exist, and the address to look up.
 *  Agency-scoped. */
export async function listFollowUpRows(
  agencyId: string,
  ids: string[],
): Promise<
  {
    id: string;
    status: string | null;
    hasCoords: boolean;
    address_line: string | null;
    city: string | null;
    postcode: string | null;
  }[]
> {
  if (ids.length === 0) return [];
  const rows = (await sql`
    select id, status, (lat is not null and lng is not null) as has_coords,
           address_line, city, postcode
    from public.disposals
    where agency_id = ${agencyId} and id = ANY(${ids}::uuid[])
  `) as {
    id: string;
    status: string | null;
    has_coords: boolean;
    address_line: string | null;
    city: string | null;
    postcode: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    hasCoords: r.has_coords,
    address_line: r.address_line,
    city: r.city,
    postcode: r.postcode,
  }));
}
