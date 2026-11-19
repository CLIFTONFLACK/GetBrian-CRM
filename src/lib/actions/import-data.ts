"use server";

import { revalidatePath } from "next/cache";

import { requireAgencyAdmin } from "@/lib/auth/require-admin";
import { createCompany, type CompanyWriteInput } from "@/lib/db/queries/companies";
import { createContact, type ContactWriteInput } from "@/lib/db/queries/contacts";
import { createDisposal, type DisposalWriteInput } from "@/lib/db/queries/disposals";
import {
  listCompanyNameMap,
  listCompanyNumberMap,
  listContactDateMap,
  listContactConsent,
  listContactEmailMap,
  listContactNameMap,
  listDisposalRefMap,
  listFollowUpRows,
  listRequirementIdentities,
  listRequirementRefMap,
  setImportedDateUpdated,
  updateCompanyFromImport,
  updateContactFromImport,
  updateDisposalFromImport,
  updateRequirementFromImport,
  type CompanyImportPatch,
  type ContactImportPatch,
  type DisposalImportPatch,
  type ImportUpdateResult,
  type RequirementImportPatch,
} from "@/lib/db/queries/import";
import { refreshMatchesForListings } from "@/lib/actions/matches";
import { isListingMatchable } from "@/lib/badges";
import { isValidContactEmail } from "@/lib/contact-links";
import { updateDisposalCoords } from "@/lib/db/queries/intel";
import { pool } from "@/lib/intel/sources";
import {
  capList,
  collectListingIds,
  dryRunFollowUp,
  followUpSummary,
  GEOCODE_CONCURRENCY,
  geocodeWindow,
  shouldRescore,
  MAX_GEOCODE_LISTINGS,
  MAX_RESCORE_LISTINGS,
  type FollowUpResult,
} from "@/lib/import-followup";
import { listCompanyTypes, listContactRoles } from "@/lib/db/queries/lookups";
import { createRequirement, type RequirementWriteInput } from "@/lib/db/queries/requirements";
import { deriveCounty } from "@/lib/locations";
import {
  COUNTY_OPTIONS,
  DISTRICT_OPTIONS,
  LONDON_AREA_OPTIONS,
  REGION_OPTIONS,
  TOWN_OPTIONS,
} from "@/lib/locations/options";
import { addressQuery, geocodeAddress } from "@/lib/maps/geocode";
import {
  companyFileKeys,
  contactNameKey,
  matchCompanyId,
  mergePatch,
  normaliseKey as key,
} from "@/lib/import-matching";
import {
  buildLocationCatalog,
  capCell,
  hasLetterOrDigit,
  isMoreThanADayAhead,
  joinNoteLines,
  MAX_CELL_CHARS,
  legacyRowRef,
  mergeNotes,
  parseArea,
  parseBool,
  parseCompanyType,
  parseRent,
  parseSize,
  parseSourceDate,
  parseTenant,
  planAdoptions,
  summariseReasons,
  unionTags,
} from "@/lib/import-parse";
import { requirementLinkError } from "@/lib/requirement-rules";
import { Constants } from "@/lib/database.types";
import {
  IMPORT_TEMPLATES,
  importFileKind,
  mapHeaders,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  parseCsv,
  REQUIRED_COLUMNS,
  splitList,
  type ImportEntity,
} from "@/lib/csv";
import {
  formatUseClasses,
  parseUseClasses,
  partitionSectorTags,
  planningClassFor,
} from "@/lib/use-classes";
import type { FormState } from "@/lib/actions/types";

// Reuses each domain's existing create* DAO function
// (createCompany/createContact/createRequirement/createDisposal) rather than
// duplicating insert logic — see AGENTS.md. Every write here runs one row at
// a time (N sequential round trips for an N-row CSV) rather than a single
// bulk statement: admin CSV import isn't a hot path, and reusing the
// per-domain DAOs (each with its own validation-free insert shape) is worth
// more than the extra round trips.
//
// ─────────────────────────────────────────────────────────────────────────────
// Upsert, not insert
// ─────────────────────────────────────────────────────────────────────────────
// A row that matches a record already in the system UPDATES it; only genuinely
// new rows are inserted. Match keys:
//
//   company      company_number when supplied, else name (case-insensitive)
//   contact      email when supplied, else first+last name within the same company
//   requirement  external_ref. A file with no external_ref column gets a stable
//                one derived from six fixed cells of the row (legacyRowRef).
//                THE LIMIT: with no ID column in the source file there is no
//                true identity. An exact re-upload updates the same rows. A row
//                that CHANGED in the source has a different reference, so it is
//                matched to the stored requirement by title and contact (or
//                company) when exactly one stored requirement and exactly one
//                file row share them (it is "adopted" and takes the new
//                reference); otherwise it is added as a new requirement and
//                counted as a possible changed copy, because guessing would
//                overwrite the wrong record.
//   listing      external_ref  (stored as disposals.source_ref, source='import')
//
// The same keys de-duplicate WITHIN one file: a second row for a key already
// seen merges into the first rather than being rejected, so a spreadsheet that
// repeats a company across several lines produces one record carrying all of
// it, last non-blank value winning.
//
// Updates are blank-preserving — see the note in src/lib/db/queries/import.ts.
// A cell the file leaves empty keeps whatever the record already holds, so a
// partial upload tops records up instead of wiping them. Notes never
// overwrite: incoming notes are appended (mergeNotes).
//
// Dry run: the same parsing, matching and validation with zero writes. The
// "Check file" button sends dryRun=1 and gets the same summary back.
//
// Caveat worth knowing: the lookup maps are read once, before any write. Within
// a single import that is exact; against a *concurrent* import (or someone
// using the forms at the same time) it is not, which is why
// db/migrations/0041 adds the matching unique indexes as the real backstop.

const ENTITIES: ImportEntity[] = ["companies", "contacts", "requirements", "listings"];
const LISTING_TYPES = ["cdg", "intel"];

const LOCATION_CATALOG = buildLocationCatalog({
  neighbourhoods: LONDON_AREA_OPTIONS.map((a) => a[0]),
  towns: TOWN_OPTIONS,
  counties: COUNTY_OPTIONS,
  regions: REGION_OPTIONS,
  districts: DISTRICT_OPTIONS.map((d) => d[0]),
});

// Multi-value cells use ";" in our template and "," in every other system's
// export — splitList handles both. See csv.ts for why it isn't just a split.
const list = splitList;
const numOrNull = (v: string) => {
  const n = Number(v.replace(/[, ]/g, ""));
  return v.trim() && Number.isFinite(n) ? n : null;
};
const oneOf = (v: string, allowed: readonly string[], fb: string) =>
  allowed.includes(v) ? v : fb;
// Loose format check — good enough to catch obvious CSV garbage (missing "@",
// no domain) without rejecting real addresses a stricter regex might miss.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailOrNull = (v: string) => (v && EMAIL_RE.test(v) ? v : null);

type ParsedAddress = {
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  county: string | null;
};

/** Postgres SQLSTATE → a message safe to show the user. The raw driver text
 *  names constraints and columns that mean nothing to an importer and can leak
 *  schema detail, so only the class of failure is reported. */
function writeErrorMessage(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  switch (code) {
    case "23505":
      return "Duplicate: a record with this name/email/reference already exists";
    case "23503":
      return "Linked record not found";
    case "22P02":
      return "Invalid value";
    default:
      return "Could not save this row";
  }
}

/** Fold a later row's patch into an earlier one for the same record: supplied
 *  values win (later row first), notes are combined rather than replaced, tags
 *  are unioned, and of two source dates the newer one stands. */
function foldPatch<T extends { notes: string | null; dateUpdated: string | null }>(
  into: T,
  from: T,
): void {
  const notesBefore = into.notes;
  const dateBefore = into.dateUpdated;
  const tagsBefore = (into as { sectorTags?: string[] | null }).sectorTags;
  mergePatch(into, from);
  if (notesBefore && from.notes) into.notes = mergeNotes(notesBefore, from.notes);
  if (dateBefore && from.dateUpdated && dateBefore > from.dateUpdated) into.dateUpdated = dateBefore;
  const tagsFrom = (from as { sectorTags?: string[] | null }).sectorTags;
  if (tagsBefore && tagsFrom) {
    (into as { sectorTags?: string[] | null }).sectorTags = unionTags(tagsBefore, tagsFrom);
  }
}

// A NEW record is inserted from `fields`, not from the patch, so after rows are
// folded together the fields must take the folded values too — otherwise a
// repeated row's notes, mobile or alerts would be silently dropped.
function syncCompanyFields(f: CompanyWriteInput, p: CompanyImportPatch): void {
  f.name = p.name ?? f.name;
  f.type = p.type ?? f.type;
  f.sectorTags = p.sectorTags ?? f.sectorTags;
  f.website = p.website ?? f.website;
  f.phone = p.phone ?? f.phone;
  f.notes = p.notes ?? f.notes;
  f.companyNumber = p.companyNumber ?? f.companyNumber;
  f.vatNumber = p.vatNumber ?? f.vatNumber;
  f.addressLine = p.addressLine ?? f.addressLine;
  f.city = p.city ?? f.city;
  f.postcode = p.postcode ?? f.postcode;
  f.county = p.county ?? f.county;
}

function syncContactFields(f: ContactWriteInput, p: ContactImportPatch): void {
  f.firstName = p.firstName ?? f.firstName;
  f.lastName = p.lastName ?? f.lastName;
  f.email = p.email ?? f.email;
  f.phone = p.phone ?? f.phone;
  f.mobile = p.mobile ?? f.mobile;
  f.role = p.role ?? f.role;
  f.notes = p.notes ?? f.notes;
  f.marketingOptIn = p.marketingOptIn === true ? true : f.marketingOptIn;
  f.marketingPropertyAlerts = p.marketingPropertyAlerts === true ? true : f.marketingPropertyAlerts;
  f.addressLine = p.addressLine ?? f.addressLine;
  f.city = p.city ?? f.city;
  f.postcode = p.postcode ?? f.postcode;
  f.county = p.county ?? f.county;
}

function syncRequirementFields(f: RequirementWriteInput, p: RequirementImportPatch): void {
  f.title = p.title ?? f.title;
  f.companyId = p.companyId ?? f.companyId;
  f.contactId = p.contactId ?? f.contactId;
  f.status = (p.status ?? f.status) as RequirementWriteInput["status"];
  f.targetTowns = p.targetTowns ?? f.targetTowns;
  f.targetRegions = p.targetRegions ?? f.targetRegions;
  f.targetCounties = p.targetCounties ?? f.targetCounties;
  f.targetPostcodeDistricts = p.targetPostcodeDistricts ?? f.targetPostcodeDistricts;
  f.targetNeighbourhoods = p.targetNeighbourhoods ?? f.targetNeighbourhoods;
  f.targetLondonZones = p.targetLondonZones ?? f.targetLondonZones;
  f.useClasses = (p.useClasses ?? f.useClasses) as RequirementWriteInput["useClasses"];
  f.tenurePrefs = (p.tenurePrefs ?? f.tenurePrefs) as RequirementWriteInput["tenurePrefs"];
  f.minSqft = p.minSqft ?? f.minSqft;
  f.maxSqft = p.maxSqft ?? f.maxSqft;
  f.minCovers = p.minCovers ?? f.minCovers;
  f.maxCovers = p.maxCovers ?? f.maxCovers;
  f.maxRent = p.maxRent ?? f.maxRent;
  f.maxPremium = p.maxPremium ?? f.maxPremium;
  f.maxGuidePrice = p.maxGuidePrice ?? f.maxGuidePrice;
  f.notes = p.notes ?? f.notes;
}

// Same as the three above, for listings: a new listing is inserted from `fields`.
function syncListingFields(f: DisposalWriteInput, p: DisposalImportPatch): void {
  f.title = p.title ?? f.title;
  f.contactId = p.contactId ?? f.contactId;
  f.listingType = p.listingType ?? f.listingType;
  f.status = p.status ?? f.status;
  f.disposalType = p.disposalType ?? f.disposalType;
  f.addressLine = p.addressLine ?? f.addressLine;
  f.area = p.area ?? f.area;
  f.city = p.city ?? f.city;
  f.county = p.county ?? f.county;
  f.postcode = p.postcode ?? f.postcode;
  f.propertyType = p.propertyType ?? f.propertyType;
  f.useClass = p.useClass ?? f.useClass;
  f.sizeSqft = p.sizeSqft ?? f.sizeSqft;
  f.coversInternal = p.coversInternal ?? f.coversInternal;
  f.rentPa = p.rentPa ?? f.rentPa;
  f.premium = p.premium ?? f.premium;
  f.guidePrice = p.guidePrice ?? f.guidePrice;
  f.description = p.description ?? f.description;
}

/** Bulk-import CSV rows into companies / contacts / requirements / listings
 *  (#8). Admin only: a whole-book write (and a way to overwrite existing
 *  records by matching key) is the same class of power as the admin panel.
 *  With dryRun=1 in the form data nothing is written. */
export async function importEntityCsv(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // One clock for the whole action: the follow-up steps below decide what to
  // run from how much of the 120 s the row writes have used.
  const startedAt = Date.now();
  const caller = await requireAgencyAdmin();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const entity = String(formData.get("entity") ?? "") as ImportEntity;
  const csv = String(formData.get("csv") ?? "");
  const fileName = String(formData.get("fileName") ?? "");
  const dryRun = String(formData.get("dryRun") ?? "") === "1";
  if (!ENTITIES.includes(entity)) return { error: "Unknown import type." };
  if (fileName && !importFileKind(fileName)) {
    return { error: "Upload a .csv, .xlsx or .xls file." };
  }
  if (!csv.trim()) return { error: "Upload a CSV file first." };
  if (new TextEncoder().encode(csv).length > MAX_IMPORT_BYTES) {
    return {
      error: `This file is too large (limit ${Math.round(MAX_IMPORT_BYTES / 1_000_000)} MB of text). Split it into smaller files.`,
    };
  }

  const rows = parseCsv(csv);
  // Headers are matched loosely (case, spaces vs underscores, common synonyms)
  // and the header row is located rather than assumed, because exports from
  // other systems lead with a title banner. See mapHeaders in csv.ts.
  const header = mapHeaders(entity, rows);
  const { columns, headerRow } = header;
  if (rows.length <= headerRow + 1) {
    return { error: "Need a header row plus at least one data row." };
  }
  if (rows.length - headerRow - 1 > MAX_IMPORT_ROWS) {
    return {
      error: `This file has ${rows.length - headerRow - 1} data rows; the limit is ${MAX_IMPORT_ROWS}. Nothing was read. Split it into smaller files.`,
    };
  }
  // A column the file simply doesn't have is a fault of the file, not of every
  // row in it: say so once, naming the column, instead of reporting N identical
  // "x is required" row errors that never point at the real problem.
  const missing = REQUIRED_COLUMNS[entity].filter((c) => !columns.has(c));
  if (missing.length > 0) {
    const found = (rows[headerRow] ?? []).map((c) => c.trim()).filter(Boolean);
    return {
      error:
        `This file has no ${missing.map((c) => `"${c}"`).join(" or ")} column, so no rows ` +
        `can be imported. Header row read as: ${found.join(", ") || "(blank)"}. ` +
        `Download the ${IMPORT_TEMPLATES[entity].label} template and match its column names.`,
    };
  }
  // A requirement needs a company OR a contact (src/lib/requirement-rules.ts).
  // That's an either/or, which REQUIRED_COLUMNS (an AND list) can't express, so
  // the header-level half of the check lives here.
  if (entity === "requirements" && !columns.has("contact_email") && !columns.has("company_name")) {
    const found = (rows[headerRow] ?? []).map((c) => c.trim()).filter(Boolean);
    return {
      error:
        `This file has neither a "contact_email" nor a "company_name" column, so no ` +
        `requirement can be linked to anything. Header row read as: ` +
        `${found.join(", ") || "(blank)"}. Download the Requirements template.`,
    };
  }

  // Contact roles + company types are editable data now — validate imported
  // values against the live lists (fallbacks "other") rather than a fixed enum.
  // Both are system-wide lookups (not agency-scoped — see lookups.ts).
  const roleSlugs = (await listContactRoles()).map((r) => r.slug);
  const companyTypes = await listCompanyTypes();

  // Listings must reference an existing contact; requirements may reference a
  // contact, a company, or both. Rows naming a contact we can't find are
  // reported and skipped rather than silently unlinked.
  const contactByEmail = await listContactEmailMap(agencyId);
  const resolveContact = (email: string) =>
    email ? contactByEmail.get(key(email)) : undefined;

  // Existing records, keyed for matching. Loaded per entity — only what that
  // import actually needs.
  const companyIdByName =
    entity === "companies" || entity === "contacts" || entity === "requirements"
      ? await listCompanyNameMap(agencyId)
      : new Map<string, string>();
  const companyIdByNumber =
    entity === "companies" ? await listCompanyNumberMap(agencyId) : new Map<string, string>();
  const contactIdByName =
    entity === "contacts" ? await listContactNameMap(agencyId) : new Map<string, string>();
  const contactDates =
    entity === "requirements" ? await listContactDateMap(agencyId) : new Map<string, string>();
  const requirementIdByRef =
    entity === "requirements" ? await listRequirementRefMap(agencyId) : new Map<string, string>();
  const requirementIdentities =
    entity === "requirements" ? await listRequirementIdentities(agencyId) : [];
  const disposalIdByRef =
    entity === "listings" ? await listDisposalRefMap(agencyId) : new Map<string, string>();

  type CompanyRecord = {
    address: ParsedAddress;
    fields: CompanyWriteInput;
    patch: CompanyImportPatch;
    existingId: string | null;
    rowNo: number;
  };
  type ContactRecord = {
    address: ParsedAddress;
    fields: ContactWriteInput;
    patch: ContactImportPatch;
    companyName: string | null;
    /** Null until the name fallback runs, which needs the company resolved. */
    existingId: string | null;
    hadEmailMatch: boolean;
    rowNo: number;
  };
  type RequirementRecord = {
    fields: RequirementWriteInput;
    patch: RequirementImportPatch;
    externalRef: string | null;
    existingId: string | null;
    companyName: string | null;
    /** The linked contact's date_updated, used for a NEW row with no date of its own. */
    fallbackDate: string | null;
    /** True when the reference came from legacyRowRef (the file had no ID column). */
    refIsDerived: boolean;
    rowNo: number;
  };
  type ListingRecord = {
    fields: DisposalWriteInput;
    patch: DisposalImportPatch;
    externalRef: string | null;
    existingId: string | null;
    rowNo: number;
  };

  const companyRecords: CompanyRecord[] = [];
  const contactRecords: ContactRecord[] = [];
  const requirementRecords: RequirementRecord[] = [];
  const listingRecords: ListingRecord[] = [];
  const errors: string[] = [];
  // Values we could not use but that didn't cost the whole row — reported so a
  // partially imported row is visible rather than silent.
  const warnings: string[] = [];
  // Rows in this file already claimed by a record, so a key repeated later in
  // the same file merges into it instead of creating a second copy.
  const recordByFileKey = new Map<string, { patch: object }>();
  let mergedInFile = 0;
  // Requirement free-text outcomes, reported so nothing is silently dropped.
  const stats = { rentKeptInNotes: 0, sizeKeptInNotes: 0, areaNotFullyPlaced: 0, noLink: 0 };

  rows.slice(headerRow + 1).forEach((r, n) => {
    const rowNo = headerRow + n + 2;
    // Several source columns can feed one field: take the first that actually
    // has a value.
    const get = (name: string) => {
      for (const i of columns.get(name) ?? []) {
        const v = (r[i] ?? "").trim();
        if (v) return v;
      }
      return "";
    };
    /** Supplied-or-null, the shape every patch field takes. */
    const opt = (name: string) => get(name) || null;
    // A non-empty cell that isn't a number ("175 sq m") is reported rather than
    // quietly stored as null. Currency text ("£120,000") is NOT a number here:
    // numOrNull strips commas and spaces only.
    const num = (name: string) => {
      const raw = get(name);
      const value = numOrNull(raw);
      if (raw && value === null)
        warnings.push(`Row ${rowNo}: ignored ${name} "${raw}" — not a number`);
      return value;
    };
    /** The row's Date Updated as an ISO instant, or null (with a warning). */
    const dateOf = (): string | null => {
      const full = get("date_updated");
      // A hostile cell is never echoed whole into a message.
      const raw = full.length > 40 ? `${full.slice(0, 40)}...` : full;
      const parsed = parseSourceDate(full);
      if (parsed.kind === "invalid") {
        warnings.push(`Row ${rowNo}: ignored date_updated "${raw}" — not a recognised date`);
        return null;
      }
      if (parsed.kind === "ok" && isMoreThanADayAhead(parsed.iso, Date.now())) {
        warnings.push(`Row ${rowNo}: ignored date_updated "${raw}" — it is in the future`);
        return null;
      }
      return parsed.kind === "ok" ? parsed.iso : null;
    };
    /** Yes/No cell: true, false or null (blank or unreadable, the latter warned). */
    const boolOf = (name: string): boolean | null => {
      const raw = get(name);
      const v = parseBool(raw);
      if (v === "invalid") {
        warnings.push(`Row ${rowNo}: ignored ${name} "${raw}" — not Yes/No`);
        return null;
      }
      return v;
    };
    /**
     * Claim one or more keys for this file. Returns the earlier record when any
     * of them is already taken, in which case the caller merges into it and
     * adds nothing new. Several keys let a record answer to every identity a
     * later row might use (a company's CRN and its name), so a row carrying
     * only one of them still finds it.
     */
    const claim = (keys: string | string[], rec: { patch: object }) => {
      const ks = Array.isArray(keys) ? keys : [keys];
      const prior = ks.map((k) => recordByFileKey.get(k)).find(Boolean);
      if (prior) {
        mergedInFile++;
        // Any key the prior didn't yet hold now points at it too.
        for (const k of ks) if (!recordByFileKey.has(k)) recordByFileKey.set(k, prior);
        return prior;
      }
      for (const k of ks) recordByFileKey.set(k, rec);
      return null;
    };
    try {
      if (entity === "companies") {
        const name = get("name");
        if (!name) throw new Error("name is required");
        // "-", "." and "…" rows are placeholders in other systems' exports.
        if (!hasLetterOrDigit(name)) {
          warnings.push(`Row ${rowNo}: skipped — name "${name}" has no letters or digits`);
          return;
        }
        const number = get("company_number");
        // company_number is the strong key: a company can be renamed and still
        // be the same company. Name is the fallback.
        const existingId = matchCompanyId(number, name, companyIdByNumber, companyIdByName);
        const address: ParsedAddress = {
          address_line: get("address_line") || null,
          city: get("city") || null,
          postcode: get("postcode") || null,
          county:
            get("county") ||
            deriveCounty({ postcode: get("postcode"), city: get("city") }),
        };
        // "Applicant, Investor (Institutional)": every value is matched against
        // the company types by slug or label. The first match is the type; the
        // rest are kept as free tags rather than lost.
        const typeCell = get("type");
        const typeValues = typeCell ? list(typeCell) : [];
        const parsedType = parseCompanyType(typeValues, companyTypes);
        // A new company with no recognised type becomes Other; an existing one
        // keeps the type it has (a spreadsheet label must not overwrite a real
        // classification with "Other").
        if (typeValues.length > 0 && parsedType.type === null) {
          warnings.push(
            existingId
              ? `Row ${rowNo}: company type "${typeCell}" matches no company type — kept the stored type`
              : `Row ${rowNo}: company type "${typeCell}" matches no company type — set to Other`,
          );
        }
        // Recognised words become use-class slugs so they show in the picker;
        // anything else ("brewery") is kept verbatim as a free tag.
        const sectorTags = (() => {
          const raw = [...list(get("sector_tags")), ...parsedType.extraTags];
          if (raw.length === 0) return null;
          const { slugs, extra } = partitionSectorTags(raw);
          return [...new Set([...slugs, ...extra])];
        })();
        const dateUpdated = dateOf();
        const patch: CompanyImportPatch = {
          name,
          type: parsedType.type ?? (typeCell && !existingId ? "other" : null),
          sectorTags,
          website: opt("website"),
          phone: opt("phone"),
          notes: opt("notes"),
          companyNumber: number || null,
          vatNumber: opt("vat_number"),
          addressLine: address.address_line,
          city: address.city,
          postcode: address.postcode,
          county: address.county,
          lat: null,
          lng: null,
          dateUpdated,
        };
        const rec: CompanyRecord = {
          address,
          existingId,
          rowNo,
          patch,
          fields: {
            name,
            type: parsedType.type ?? "other",
            sectorTags: sectorTags ?? [],
            website: opt("website"),
            phone: opt("phone"),
            addressLine: address.address_line,
            city: address.city,
            postcode: address.postcode,
            county: address.county,
            notes: opt("notes"),
            companyNumber: number || null,
            vatNumber: opt("vat_number"),
            leadAgentId: null,
          },
        };
        // Key the file-level dedupe on everything that identifies the record, so
        // "ABC Ltd" with a CRN on one line and without on another still merge.
        const prior = claim(companyFileKeys(existingId, number, name), rec);
        if (prior) {
          foldPatch(prior.patch as CompanyImportPatch, patch);
          const earlier = prior as unknown as CompanyRecord;
          syncCompanyFields(earlier.fields, earlier.patch);
        } else companyRecords.push(rec);
      } else if (entity === "contacts") {
        const firstName = get("first_name");
        if (!firstName) throw new Error("first_name is required");
        const email = emailOrNull(get("email"));
        if (get("email") && !email) {
          warnings.push(`Row ${rowNo}: ignored email "${get("email")}" — not a valid address`);
        }
        const existingId = (email ? contactByEmail.get(key(email)) : undefined) ?? null;
        // Matching uses the address as written; STORING needs a plain address
        // the CRM can safely put in a link. Anything else is imported without one.
        const storedEmail = email && isValidContactEmail(email) ? email : null;
        if (email && !storedEmail) {
          warnings.push(`Row ${rowNo}: email not stored: not a plain address`);
        }
        const address: ParsedAddress = {
          address_line: get("address_line") || null,
          city: get("city") || null,
          postcode: get("postcode") || null,
          county:
            get("county") ||
            deriveCounty({ postcode: get("postcode"), city: get("city") }),
        };
        // Phone and mobile are separate fields. A mobile-only row leaves phone
        // empty: copying one into the other would invent a landline.
        const phone = opt("phone");
        const mobile = opt("mobile");
        const optIn = boolOf("marketing_opt_in");
        const alerts = boolOf("marketing_property_alerts");
        const dateUpdated = dateOf();
        const patch: ContactImportPatch = {
          firstName,
          lastName: opt("last_name"),
          email: storedEmail,
          phone,
          mobile,
          role: get("role") ? oneOf(get("role"), roleSlugs, "other") : null,
          companyId: null, // resolved after companies are created, below
          notes: opt("notes"),
          // Only ever true or "leave alone": a blank or "No" cell must never
          // silently opt someone out of marketing they previously agreed to.
          marketingOptIn: optIn === true ? true : null,
          marketingPropertyAlerts: alerts === true ? true : null,
          addressLine: address.address_line,
          city: address.city,
          postcode: address.postcode,
          county: address.county,
          lat: null,
          lng: null,
          dateUpdated,
        };
        const rec: ContactRecord = {
          address,
          companyName: get("company_name") || null,
          existingId,
          hadEmailMatch: existingId !== null,
          rowNo,
          patch,
          fields: {
            firstName,
            lastName: opt("last_name"),
            email: storedEmail,
            phone,
            mobile,
            role: oneOf(get("role"), roleSlugs, "other"),
            companyId: null, // resolved after companies are created, below
            county: address.county,
            notes: opt("notes"),
            leadAgentId: null,
            marketingOptIn: optIn === true,
            marketingPropertyAlerts: alerts,
            addressLine: address.address_line,
            city: address.city,
            postcode: address.postcode,
          },
        };
        // Only the email is a safe in-file key at this point; the name key
        // needs the company, which isn't resolved until below. Name-keyed
        // in-file duplicates are folded in during that later pass.
        const prior = email ? claim(`email:${key(email)}`, rec) : null;
        if (prior) {
          foldPatch(prior.patch as ContactImportPatch, patch);
          const earlier = prior as unknown as ContactRecord;
          syncContactFields(earlier.fields, earlier.patch);
          earlier.companyName = earlier.companyName ?? rec.companyName;
        } else contactRecords.push(rec);
      } else if (entity === "requirements") {
        const title = get("title");
        const contactEmail = get("contact_email");
        // "Company name (Mr First Last)": with no company_name column, the part
        // before the bracket is the company to look for. It only LINKS — a
        // requirement import never creates companies.
        const tenant = parseTenant(title);
        const explicitCompany = get("company_name") || null;
        const companyName =
          explicitCompany ?? (columns.has("company_name") ? null : tenant.companyName);
        const contactId = resolveContact(contactEmail) ?? null;
        const companyId = companyName
          ? (companyIdByName.get(key(companyName)) ?? null)
          : null;
        if (explicitCompany && !companyId) {
          throw new Error(
            `company_name "${explicitCompany}" doesn't match any company — import Companies first`,
          );
        }
        if (contactEmail && !contactId) {
          // An address we hold no contact for still tells us who the tenant is,
          // when their company is known: keep the requirement, say what happened.
          if (companyId) {
            warnings.push(
              `Row ${rowNo}: contact_email "${contactEmail}" matches no contact — linked to the company only`,
            );
          } else {
            throw new Error(
              `contact_email "${contactEmail}" doesn't match any contact — import Contacts first`,
            );
          }
        }
        // A file with no reference column gets one from six fixed cells of the
        // row (legacyRowRef), so a second upload of the same export updates
        // these rows. See the note on identity at the top of this file.
        const refCell = get("external_ref");
        const refIsDerived = !refCell && !columns.has("external_ref");
        const externalRef =
          refCell ||
          (refIsDerived
            ? legacyRowRef({
                title: get("title"),
                size: get("size_text"),
                propertyType: get("use_classes"),
                rent: get("rent_text"),
                area: get("area_text"),
                email: get("contact_email"),
              })
            : null);
        const existingId = externalRef
          ? (requirementIdByRef.get(key(externalRef)) ?? null)
          : null;
        // Same rule the form enforces, so a spreadsheet can't create rows the
        // UI would reject. Only for NEW rows: an existing requirement already
        // satisfies it, and an update is blank-preserving so can only add links
        // — a ref-only "top up" row must not be refused for the cells it omits.
        if (existingId === null) {
          if (title && !contactId && !companyId) {
            stats.noLink++;
            throw new Error(
              tenant.shape === "unknown" && !contactEmail
                ? 'tenant is "Unknown" and there is no contact email'
                : "no contact email and no matching company",
            );
          }
          const invalid = requirementLinkError({ title, companyId, contactId });
          if (invalid) throw new Error(invalid);
        }
        const useClasses = parseUseClasses(get("use_classes"));
        const tenurePrefs = list(get("tenure_prefs")).filter((t) =>
          (Constants.public.Enums.tenure_type as readonly string[]).includes(t),
        );
        const arr = (name: string) => {
          const v = list(get(name));
          return v.length > 0 ? v : null;
        };

        // Size, rent and area arrive as the other system's free text. What
        // parses becomes a column; what does not stays in notes. Explicit
        // numeric / target_* columns win over the parsed text.
        // A cell over the cap is not parsed at all: its first part goes to
        // notes and the row is warned about (see MAX_CELL_CHARS).
        const sizeC = capCell(get("size_text"));
        const rentC = capCell(get("rent_text"));
        const areaC = capCell(get("area_text"));
        const overNotes: string[] = [];
        for (const [label, c] of [["Size", sizeC], ["Rent", rentC], ["Area", areaC]] as const) {
          if (!c.over) continue;
          warnings.push(`Row ${rowNo}: ${label.toLowerCase()} text is over ${MAX_CELL_CHARS} characters — not read, the first ${MAX_CELL_CHARS} kept in notes`);
          overNotes.push(`${label} (as exported): ${c.text}`);
        }
        const sizeCell = sizeC.text;
        const size = parseSize(sizeC.over ? "" : sizeCell);
        if (size.kind === "unparsed")
          warnings.push(`Row ${rowNo}: size "${sizeCell}" not recognised — kept in notes`);
        else if (size.swapped)
          warnings.push(`Row ${rowNo}: size "${sizeCell}" was written high to low — read as low to high`);
        const rent = parseRent(rentC.over ? "" : rentC.text);
        const area = parseArea(areaC.over ? "" : areaC.text, LOCATION_CATALOG);
        if (size.keepText) stats.sizeKeptInNotes++;
        if (rent.note) stats.rentKeptInNotes++;
        if (area.note) stats.areaNotFullyPlaced++;

        const minSqft = num("min_sqft") ?? size.minSqft;
        const maxSqft = num("max_sqft") ?? size.maxSqft;
        const maxRent = num("max_rent") ?? rent.maxRent;
        const notes = joinNoteLines(
          get("notes"),
          size.keepText && !sizeC.over ? `Size (as exported): ${sizeCell}` : null,
          rent.note,
          area.note,
          ...overNotes,
        );
        const orParsed = (name: string, parsed: string[]) =>
          arr(name) ?? (parsed.length > 0 ? parsed : null);
        const targetZones = orParsed("target_london_zones", area.zones);
        const targetNeighbourhoods = orParsed("target_neighbourhoods", area.neighbourhoods);
        const targetTowns = orParsed("target_towns", area.towns);
        const targetCounties = orParsed("target_counties", area.counties);
        const targetRegions = orParsed("target_regions", area.regions);
        const targetDistricts =
          arr("target_postcode_districts")?.map((s) => s.toUpperCase()) ??
          (area.districts.length > 0 ? area.districts : null);
        const status = get("status")
          ? oneOf(get("status"), Constants.public.Enums.requirement_status, "active")
          : null;
        const minCovers = num("min_covers");
        const maxCovers = num("max_covers");
        const maxPremium = num("max_premium");
        const maxGuidePrice = num("max_guide_price");
        const dateUpdated = dateOf();

        const patch: RequirementImportPatch = {
          title,
          companyId,
          contactId,
          status,
          targetTowns,
          targetRegions,
          targetCounties,
          targetPostcodeDistricts: targetDistricts,
          targetNeighbourhoods,
          targetLondonZones: targetZones,
          useClasses: useClasses.length > 0 ? useClasses : null,
          tenurePrefs: tenurePrefs.length > 0 ? tenurePrefs : null,
          minSqft,
          maxSqft,
          minCovers,
          maxCovers,
          maxRent,
          maxPremium,
          maxGuidePrice,
          notes,
          dateUpdated,
          externalRef: null,
        };
        const rec: RequirementRecord = {
          externalRef,
          refIsDerived,
          existingId,
          companyName,
          fallbackDate: contactId ? (contactDates.get(contactId) ?? null) : null,
          rowNo,
          patch,
          fields: {
            title,
            companyId,
            contactId,
            status: (status ?? "active") as RequirementWriteInput["status"],
            targetTowns: targetTowns ?? [],
            targetRegions: targetRegions ?? [],
            targetCounties: targetCounties ?? [],
            targetPostcodeDistricts: targetDistricts ?? [],
            targetNeighbourhoods: targetNeighbourhoods ?? [],
            targetLondonZones: targetZones ?? [],
            // Cells carry ordinary words ("Bar;Nightclub"), not slugs.
            useClasses: useClasses as RequirementWriteInput["useClasses"],
            tenurePrefs: tenurePrefs as RequirementWriteInput["tenurePrefs"],
            minSqft,
            maxSqft,
            minCovers,
            maxCovers,
            maxRent,
            maxPremium,
            maxGuidePrice,
            notes,
            leadAgentId: null,
          },
        };
        const prior = externalRef ? claim(`ref:${key(externalRef)}`, rec) : null;
        if (prior) {
          foldPatch(prior.patch as RequirementImportPatch, patch);
          const earlier = prior as unknown as RequirementRecord;
          syncRequirementFields(earlier.fields, earlier.patch);
        } else requirementRecords.push(rec);
      } else {
        if (!get("title")) throw new Error("title is required");
        const contactId = resolveContact(get("contact_email"));
        if (!contactId)
          throw new Error("contact_email is required and must match an existing contact");
        const externalRef = get("external_ref") || null;
        const existingId = externalRef
          ? (disposalIdByRef.get(key(externalRef)) ?? null)
          : null;
        const dt = get("disposal_type");
        const lt = get("listing_type");
        // Same derivation as the listing form: the concepts drive both columns.
        // `use_class` is still read as a fallback so an older template that
        // carried "Sui Generis" in that column still lands somewhere sensible.
        const useClasses = parseUseClasses(get("use_classes"), get("use_class"));
        const disposalType = [
          "freehold",
          "new_lease",
          "lease_assignment",
          "sublease",
          "unknown",
        ].includes(dt)
          ? dt
          : "unknown";
        const county =
          get("county") || deriveCounty({ postcode: get("postcode"), city: get("city") });
        const propertyType = useClasses.length > 0 ? formatUseClasses(useClasses) : null;
        const useClass =
          useClasses.length > 0 ? planningClassFor(useClasses) : get("use_class") || null;
        const patch: DisposalImportPatch = {
          title: get("title"),
          contactId,
          listingType: lt ? (LISTING_TYPES.includes(lt) ? lt : "cdg") : null,
          status: opt("status"),
          disposalType: dt ? disposalType : null,
          addressLine: opt("address_line"),
          area: opt("area"),
          city: opt("city"),
          county,
          postcode: opt("postcode"),
          propertyType,
          useClass,
          sizeSqft: num("size_sqft"),
          coversInternal: num("covers_internal"),
          rentPa: num("rent_pa"),
          premium: num("premium"),
          guidePrice: num("guide_price"),
          description: opt("description"),
        };
        const rec: ListingRecord = {
          externalRef,
          existingId,
          rowNo,
          patch,
          fields: {
            title: get("title"),
            listingType: LISTING_TYPES.includes(lt) ? lt : "cdg",
            status: get("status") || null,
            disposalType,
            toLet: false,
            forSale: false,
            addressLine: opt("address_line"),
            area: opt("area"),
            city: opt("city"),
            postcode: opt("postcode"),
            county,
            propertyType,
            useClass,
            sizeSqft: num("size_sqft"),
            sizeSqm: null,
            coversInternal: num("covers_internal"),
            coversExternal: null,
            fitOutState: null,
            epcRating: null,
            tenureRaw: null,
            rentPa: num("rent_pa"),
            premium: num("premium"),
            guidePrice: num("guide_price"),
            rateableValue: null,
            serviceCharge: null,
            keyFeatures: [],
            description: opt("description"),
            leadAgentId: null,
            companyId: null,
            contactId,
            summary: null,
            locationDescription: null,
            licensingNotes: null,
            vatApplicable: false,
            businessRates: null,
            estateCharge: null,
            parkingCharge: null,
            leaseTermYears: null,
            leaseExpiry: null,
            rentReviewBasis: null,
            nextRentReview: null,
            inside1954Act: false,
            rentPeriod: null,
            priceQualifier: null,
            brochureUrl: null,
          },
        };
        const prior = externalRef ? claim(`ref:${key(externalRef)}`, rec) : null;
        if (prior) {
          mergePatch(prior.patch as DisposalImportPatch, patch);
          const earlier = prior as unknown as ListingRecord;
          syncListingFields(earlier.fields, earlier.patch);
        } else listingRecords.push(rec);
      }
    } catch (e) {
      errors.push(`Row ${rowNo}: ${(e as Error).message}`);
    }
  });

  // Requirements from a file with no ID column: a row whose derived reference
  // matched nothing may be a stored requirement that was imported before
  // references existed, or one edited in the source system. Adopt it when the
  // match is unambiguous on both sides; otherwise add it and count it.
  let adopted = 0;
  let ambiguousCopies = 0;
  if (entity === "requirements" && requirementRecords.length > 0) {
    const candidates = requirementRecords.filter((q) => q.refIsDerived);
    const plan = planAdoptions(
      requirementIdentities,
      requirementRecords.map((q) => ({
        title: q.patch.title ?? "",
        contactId: q.patch.contactId,
        companyId: q.patch.companyId,
        // Rows that are not derived-ref rows never adopt, and never block.
        existingId: q.refIsDerived ? q.existingId : (q.existingId ?? "n/a"),
      })),
    );
    requirementRecords.forEach((q, i) => {
      if (!candidates.includes(q)) return;
      const target = plan.adopt.get(i);
      if (target) {
        q.existingId = target;
        q.patch.externalRef = q.externalRef;
        adopted++;
      } else if (plan.ambiguous.has(i)) {
        ambiguousCopies++;
        warnings.push(
          `Row ${q.rowNo}: possible changed copy of an existing requirement — added as new`,
        );
      }
    });
  }

  // Contacts: resolve company_name → company_id, creating minimal companies
  // (case-insensitively de-duped) for names not already in the agency.
  let companiesToCreate = 0;
  if (entity === "contacts" && contactRecords.length) {
    const newNames = new Map<string, string>();
    for (const c of contactRecords) {
      const nm = c.companyName;
      if (!nm) continue;
      if (!companyIdByName.has(key(nm)) && !newNames.has(key(nm))) newNames.set(key(nm), nm);
    }
    companiesToCreate = newNames.size;
    if (newNames.size > 0) {
      for (const name of newNames.values()) {
        if (dryRun) {
          // A stand-in id keeps the name-key logic below honest; nothing is written.
          companyIdByName.set(key(name), `dry-run:${key(name)}`);
          continue;
        }
        const created = await createCompany(
          agencyId,
          userId,
          {
            name,
            type: "other",
            sectorTags: [],
            website: null,
            phone: null,
            notes: null,
            companyNumber: null,
            vatNumber: null,
            leadAgentId: null,
            addressLine: null,
            city: null,
            postcode: null,
            county: null,
          },
          { lat: null, lng: null },
        );
        companyIdByName.set(key(name), created.id);
      }
      if (!dryRun) revalidatePath("/companies");
    }
    for (const c of contactRecords) {
      const companyId = c.companyName
        ? (companyIdByName.get(key(c.companyName)) ?? null)
        : null;
      c.fields.companyId = companyId;
      c.patch.companyId = companyId;
    }

    // Name fallback for rows with no email — now possible, because the match
    // key includes the company we just resolved. Also folds in-file name
    // duplicates together, which couldn't be done during the first pass.
    // Rows WITH an email register their name too, so an email-less line for
    // the same person at the same company further down merges into them
    // rather than becoming a second record.
    const byNameThisFile = new Map<string, ContactRecord>();
    const keep: ContactRecord[] = [];
    for (const c of contactRecords) {
      const k = contactNameKey(c.fields.firstName, c.fields.lastName, c.fields.companyId);
      if (c.hadEmailMatch || c.fields.email) {
        if (!byNameThisFile.has(k)) byNameThisFile.set(k, c);
        keep.push(c);
        continue;
      }
      const priorInFile = byNameThisFile.get(k);
      if (priorInFile) {
        foldPatch(priorInFile.patch, c.patch);
        syncContactFields(priorInFile.fields, priorInFile.patch);
        mergedInFile++;
        continue;
      }
      byNameThisFile.set(k, c);
      c.existingId = contactIdByName.get(k) ?? null;
      keep.push(c);
    }
    contactRecords.length = 0;
    contactRecords.push(...keep);
  }

  // Best-effort geocoding of imported companies/contacts that carry an address
  // (≤5 concurrent lookups; failures are ignored — rows still import, they just
  // won't appear on maps until edited). Runs BEFORE the write since the create*
  // DAOs take lat/lng as part of the write, not a follow-up update. A dry run
  // makes no lookups.
  async function geocodeAll<T extends { address: ParsedAddress }>(
    records: T[],
  ): Promise<Map<T, { lat: number | null; lng: number | null }>> {
    const geos = new Map<T, { lat: number | null; lng: number | null }>();
    if (dryRun) return geos;
    const targets = records.filter((r) => addressQuery(r.address));
    let next = 0;
    const worker = async () => {
      while (next < targets.length) {
        const record = targets[next++];
        try {
          const geo = await geocodeAddress(record.address);
          if (geo) geos.set(record, geo);
        } catch {
          // best-effort only
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(5, targets.length) }, () => worker()));
    return geos;
  }

  let created = 0;
  let updated = 0;
  // Contacts whose stored marketing choice is No while the file says Yes: the
  // import never turns a recorded No into a Yes.
  let consentKept = 0;
  const listingCreatedIds: string[] = [];
  const listingUpdatedIds: string[] = [];
  /** Apply a new row's source date; a failure here must not fail the saved row. */
  async function pinDate(
    rowNo: number,
    table: "companies" | "contacts" | "requirements",
    id: string,
    iso: string | null,
  ): Promise<void> {
    try {
      await setImportedDateUpdated(table, id, agencyId, iso);
    } catch {
      warnings.push(`Row ${rowNo}: saved, source date not applied`);
    }
  }
  // The neon HTTP driver's sql.transaction() only batches a static array of
  // queries — it can't wrap these multi-step create* calls in one atomic unit
  // without switching to a pooled connection. So instead of risking a mid-loop
  // throw that commits rows 1..N-1 and then 500s the whole action, isolate each
  // row: a failure is recorded and skipped, the rest still import. The result
  // message reports the skips (same pattern as the parse-time `errors`).
  async function writeEach<T extends { existingId: string | null; rowNo: number }>(
    records: T[],
    insert: (rec: T) => Promise<unknown>,
    update: (rec: T, id: string) => Promise<ImportUpdateResult | void>,
  ): Promise<void> {
    for (const rec of records) {
      if (dryRun) {
        if (rec.existingId) updated++;
        else created++;
        continue;
      }
      try {
        if (rec.existingId) {
          const result = await update(rec, rec.existingId);
          updated++;
          if (result?.notesConflict) {
            warnings.push(`Row ${rec.rowNo}: notes changed while importing — saved the row without the new notes`);
          }
          if (result?.consentBlocked) consentKept++;
        } else {
          await insert(rec);
          created++;
        }
      } catch (e) {
        // Never the driver's own text: see writeErrorMessage.
        errors.push(`Row ${rec.rowNo}: ${writeErrorMessage(e)}`);
      }
    }
  }

  // A dry run writes nothing, so the update never reads the stored flags: count
  // the Yes-in-file / No-in-CRM contacts here, from a read-only lookup.
  if (dryRun && entity === "contacts") {
    const stored = await listContactConsent(agencyId);
    for (const rec of contactRecords) {
      const c = rec.existingId ? stored.get(rec.existingId) : undefined;
      if (
        c &&
        ((rec.patch.marketingOptIn === true && c.optIn === false) ||
          (rec.patch.marketingPropertyAlerts === true && c.alerts === false))
      ) {
        consentKept++;
      }
    }
  }

  if (entity === "companies") {
    const geos = await geocodeAll(companyRecords);
    await writeEach(
      companyRecords,
      async (rec) => {
        const made = await createCompany(
          agencyId,
          userId,
          rec.fields,
          geos.get(rec) ?? { lat: null, lng: null },
        );
        await pinDate(rec.rowNo, "companies", made.id, rec.patch.dateUpdated);
      },
      (rec, id) => {
        const geo = geos.get(rec);
        return updateCompanyFromImport(agencyId, id, {
          ...rec.patch,
          lat: geo?.lat ?? null,
          lng: geo?.lng ?? null,
        });
      },
    );
  } else if (entity === "contacts") {
    const geos = await geocodeAll(contactRecords);
    await writeEach(
      contactRecords,
      async (rec) => {
        const made = await createContact(
          agencyId,
          userId,
          rec.fields,
          geos.get(rec) ?? { lat: null, lng: null },
        );
        await pinDate(rec.rowNo, "contacts", made.id, rec.patch.dateUpdated);
      },
      (rec, id) => {
        const geo = geos.get(rec);
        return updateContactFromImport(agencyId, id, {
          ...rec.patch,
          lat: geo?.lat ?? null,
          lng: geo?.lng ?? null,
        });
      },
    );
  } else if (entity === "requirements") {
    await writeEach(
      requirementRecords,
      async (rec) => {
        const made = await createRequirement(agencyId, userId, rec.fields, rec.externalRef);
        // The file's date, else the linked contact's, else the default (now).
        await pinDate(
          rec.rowNo,
          "requirements",
          made.id,
          rec.patch.dateUpdated ?? rec.fallbackDate,
        );
      },
      (rec, id) => updateRequirementFromImport(agencyId, id, rec.patch),
    );
  } else {
    await writeEach(
      listingRecords,
      async (rec) => {
        const made = await createDisposal(
          agencyId,
          userId,
          rec.fields,
          { lat: null, lng: null },
          "import",
          rec.externalRef,
        );
        listingCreatedIds.push(made.id);
      },
      async (rec, id) => {
        await updateDisposalFromImport(agencyId, id, rec.patch);
        listingUpdatedIds.push(id);
      },
    );
  }

  // Listings only: give what the import wrote coordinates and match scores, as
  // the listing form and the intel resync do. Every listing_type is included.
  // Best-effort and bounded: see src/lib/import-followup.ts for the numbers.
  let followUp = "";
  if (entity === "listings") {
    if (dryRun) {
      const stored = await listFollowUpRows(
        agencyId,
        listingRecords.flatMap((r) => (r.existingId ? [r.existingId] : [])),
      );
      const storedById = new Map(stored.map((r) => [r.id, r]));
      let live = 0;
      let needCoords = 0;
      for (const r of listingRecords) {
        const old = r.existingId ? storedById.get(r.existingId) : undefined;
        const status = r.fields.status ?? old?.status ?? null;
        if (!isListingMatchable(status)) continue;
        live++;
        const lacksCoords = old ? !old.hasCoords : true;
        if (lacksCoords && addressQuery(old && !r.fields.addressLine ? old : r.fields)) needCoords++;
      }
      followUp = dryRunFollowUp(live, needCoords);
    } else {
      const ids = collectListingIds(listingCreatedIds, listingUpdatedIds);
      const result: FollowUpResult = {
        scored: 0,
        pairsSaved: 0,
        scoringOk: true,
        notScored: 0,
        rescoreRemainder: 0,
        rescoreSkipped: false,
        geocoded: 0,
        geocodeRemainder: 0,
        geocodeNoMatch: 0,
        geocodeSaveFailed: 0,
        failures: [],
      };
      if (ids.length > 0) {
        let live: string[] = [];
        let needCoords: { id: string; address_line: string | null; city: string | null; postcode: string | null }[] = [];
        try {
          const rows = await listFollowUpRows(agencyId, ids);
          const liveRows = rows.filter((r) => isListingMatchable(r.status));
          result.notScored = rows.length - liveRows.length;
          live = liveRows.map((r) => r.id);
          needCoords = liveRows.filter((r) => !r.hasCoords && addressQuery(r));
        } catch {
          result.failures.push("the listings could not be read back for coordinates and scoring");
        }

        // Coordinates first (live listings only; let, sold and withdrawn stock
        // neither uses the cap nor is geocoded), inside the one shared clock.
        const win = geocodeWindow(Date.now() - startedAt);
        const { take, remainder } = capList(needCoords, MAX_GEOCODE_LISTINGS);
        result.geocodeRemainder = remainder;
        if (!win.run) {
          result.geocodeRemainder += take.length;
        } else if (take.length > 0) {
          const deadline = Date.now() + win.budgetMs;
          try {
            await pool(take, GEOCODE_CONCURRENCY, async (row) => {
              if (Date.now() > deadline) {
                result.geocodeRemainder++;
                return null;
              }
              let loc: Awaited<ReturnType<typeof geocodeAddress>> = null;
              try {
                loc = await geocodeAddress(row);
              } catch {
                loc = null;
              }
              if (!loc) {
                result.geocodeNoMatch++;
                return null;
              }
              try {
                if (await updateDisposalCoords(agencyId, row.id, loc.lat, loc.lng)) result.geocoded++;
                else result.geocodeSaveFailed++;
              } catch {
                result.geocodeSaveFailed++;
              }
              return null;
            });
          } catch {
            result.failures.push("coordinates could not be looked up");
          }
        }

        // Then scoring: one call for the whole batch, so the helper sends at
        // most one bell notification per agent for hundreds of listings.
        if (live.length > 0) {
          if (!shouldRescore(Date.now() - startedAt)) {
            result.rescoreSkipped = true;
            result.rescoreRemainder = live.length;
          } else {
            const { take: batch, remainder: left } = capList(live, MAX_RESCORE_LISTINGS);
            result.rescoreRemainder = left;
            const refreshed = await refreshMatchesForListings(batch);
            result.scored = refreshed.matchable;
            result.pairsSaved = refreshed.pairsSaved;
            result.scoringOk = refreshed.ok;
          }
        }
        revalidatePath("/matches");
      }
      followUp = followUpSummary(result);
    }
  }

  if (!dryRun) revalidatePath(`/${entity}`);

  // Skips and ignored values are grouped by reason, with counts, so 161
  // identical reasons read as one line; the first few row numbers follow.
  const skipped = errors.length
    ? ` Skipped ${errors.length}: ${summariseReasons(errors)}.`
    : "";
  // Columns the file carried that we had no home for. Silently dropping these
  // is how a companies file imported 25 names and threw away every address.
  const ignored = header.unrecognised.length
    ? ` Ignored ${header.unrecognised.length} unrecognised column${
        header.unrecognised.length > 1 ? "s" : ""
      }: ${header.unrecognised.join(", ")}.`
    : "";
  const notes = warnings.length
    ? ` ${warnings.length} warning${warnings.length > 1 ? "s" : ""}: ${summariseReasons(warnings)}.`
    : "";
  const merged = mergedInFile
    ? ` Merged ${mergedInFile} repeated row${mergedInFile > 1 ? "s" : ""} within the file.`
    : "";
  const freeText =
    entity === "requirements"
      ? [
          stats.rentKeptInNotes ? `${stats.rentKeptInNotes} rent text kept in notes` : "",
          stats.sizeKeptInNotes ? `${stats.sizeKeptInNotes} size text kept in notes` : "",
          stats.areaNotFullyPlaced ? `${stats.areaNotFullyPlaced} area text not fully placed (kept in notes)` : "",
        ].filter(Boolean)
      : [];
  const kept = freeText.length ? ` ${freeText.join("; ")}.` : "";
  const matching =
    entity === "requirements" && (adopted || ambiguousCopies)
      ? ` ${dryRun ? "Would match" : "Matched"} ${adopted} changed row${adopted === 1 ? "" : "s"} to existing requirements by tenant and contact (adopted); ${ambiguousCopies} possible changed cop${ambiguousCopies === 1 ? "y" : "ies"} of existing requirements added as new.`
      : "";
  const consent = consentKept
    ? ` ${consentKept} existing contact${consentKept > 1 ? "s are" : " is"} marked Yes in the file but No in the CRM. The import does not change marketing consent for an existing contact. Change it on the contact record if the consent is valid.`
    : "";
  const companiesNote =
    dryRun && companiesToCreate
      ? ` Would also add ${companiesToCreate} compan${companiesToCreate > 1 ? "ies" : "y"} named only by contacts.`
      : "";
  const prefix = dryRun ? "Check only, nothing saved. " : "";
  if (!created && !updated && errors.length)
    return {
      error: `${prefix}Nothing ${dryRun ? "would be " : ""}imported.${skipped}${ignored}${notes}${merged}${kept}${matching}${consent}${followUp}`,
    };
  // "Added N, updated M" rather than one total: on a re-upload the difference
  // between the two is the whole point of the run.
  const summary = [
    created ? `${dryRun ? "Would add" : "Added"} ${created}` : "",
    updated ? `${dryRun ? "would update" : "updated"} ${updated}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return {
    message: `${prefix}${summary || "No changes"} ${entity}.${companiesNote}${skipped}${ignored}${notes}${merged}${kept}${matching}${consent}${followUp}`,
  };
}
