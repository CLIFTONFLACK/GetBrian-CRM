"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { createCompany, type CompanyWriteInput } from "@/lib/db/queries/companies";
import { createContact, type ContactWriteInput } from "@/lib/db/queries/contacts";
import { createDisposal, type DisposalWriteInput } from "@/lib/db/queries/disposals";
import {
  listCompanyNameMap,
  listCompanyNumberMap,
  listContactEmailMap,
  listContactNameMap,
  listDisposalRefMap,
  listRequirementRefMap,
  updateCompanyFromImport,
  updateContactFromImport,
  updateDisposalFromImport,
  updateRequirementFromImport,
  type CompanyImportPatch,
  type ContactImportPatch,
  type DisposalImportPatch,
  type RequirementImportPatch,
} from "@/lib/db/queries/import";
import { listCompanyTypes, listContactRoles } from "@/lib/db/queries/lookups";
import { createRequirement, type RequirementWriteInput } from "@/lib/db/queries/requirements";
import { deriveCounty } from "@/lib/locations";
import { addressQuery, geocodeAddress } from "@/lib/maps/geocode";
import {
  companyFileKey,
  contactNameKey,
  matchCompanyId,
  mergePatch,
  normaliseKey as key,
} from "@/lib/import-matching";
import { requirementLinkError } from "@/lib/requirement-rules";
import { Constants } from "@/lib/database.types";
import {
  IMPORT_TEMPLATES,
  mapHeaders,
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
//   requirement  external_ref  (opt-in: blank means "always insert")
//   listing      external_ref  (stored as disposals.source_ref, source='import')
//
// The same keys de-duplicate WITHIN one file: a second row for a key already
// seen merges into the first rather than being rejected, so a spreadsheet that
// repeats a company across several lines produces one record carrying all of
// it, last non-blank value winning.
//
// Updates are blank-preserving — see the note in src/lib/db/queries/import.ts.
// A cell the file leaves empty keeps whatever the record already holds, so a
// partial upload tops records up instead of wiping them.
//
// Caveat worth knowing: the lookup maps are read once, before any write. Within
// a single import that is exact; against a *concurrent* import (or someone
// using the forms at the same time) it is not, which is why
// db/migrations/0041 adds the matching unique indexes as the real backstop.

const ENTITIES: ImportEntity[] = ["companies", "contacts", "requirements", "listings"];
const LISTING_TYPES = ["cdg", "intel"];

// Multi-value cells use ";" in our template and "," in every other system's
// export — splitList handles both. See csv.ts for why it isn't just a split.
const list = splitList;
const numOrNull = (v: string) => {
  const n = Number(v.replace(/[, ]/g, ""));
  return v.trim() && Number.isFinite(n) ? n : null;
};
const boolOf = (v: string) => /^(true|yes|y|1)$/i.test(v.trim());
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

/** Resolves the signed-in caller's user id + agency id, or an error message. */
async function requireCaller(): Promise<
  { userId: string; agencyId: string } | { error: string }
> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };
  return { userId: session.user.id, agencyId };
}

/** Bulk-import CSV rows into companies / contacts / requirements / listings (#8). */
export async function importEntityCsv(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };
  const { userId, agencyId } = caller;

  const entity = String(formData.get("entity") ?? "") as ImportEntity;
  const csv = String(formData.get("csv") ?? "");
  if (!ENTITIES.includes(entity)) return { error: "Unknown import type." };
  if (!csv.trim()) return { error: "Upload a CSV file first." };

  const rows = parseCsv(csv);
  // Headers are matched loosely (case, spaces vs underscores, common synonyms)
  // and the header row is located rather than assumed, because exports from
  // other systems lead with a title banner. See mapHeaders in csv.ts.
  const header = mapHeaders(entity, rows);
  const { columns, headerRow } = header;
  if (rows.length <= headerRow + 1) {
    return { error: "Need a header row plus at least one data row." };
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
  // values against the live slug lists (fallbacks "other") rather than a fixed enum.
  // Both are system-wide lookups (not agency-scoped — see lookups.ts).
  const roleSlugs = (await listContactRoles()).map((r) => r.slug);
  const typeSlugs = (await listCompanyTypes()).map((t) => t.slug);

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
  const requirementIdByRef =
    entity === "requirements" ? await listRequirementRefMap(agencyId) : new Map<string, string>();
  const disposalIdByRef =
    entity === "listings" ? await listDisposalRefMap(agencyId) : new Map<string, string>();

  type CompanyRecord = {
    address: ParsedAddress;
    fields: CompanyWriteInput;
    patch: CompanyImportPatch;
    existingId: string | null;
  };
  type ContactRecord = {
    address: ParsedAddress;
    fields: ContactWriteInput;
    patch: ContactImportPatch;
    companyName: string | null;
    /** Null until the name fallback runs, which needs the company resolved. */
    existingId: string | null;
    hadEmailMatch: boolean;
  };
  type RequirementRecord = {
    fields: RequirementWriteInput;
    patch: RequirementImportPatch;
    externalRef: string | null;
    existingId: string | null;
    companyName: string | null;
    rowNo: number;
  };
  type ListingRecord = {
    fields: DisposalWriteInput;
    patch: DisposalImportPatch;
    externalRef: string | null;
    existingId: string | null;
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

  rows.slice(headerRow + 1).forEach((r, n) => {
    const rowNo = headerRow + n + 2;
    // Several source columns can feed one field ("Phone Number" and "Mobile
    // Number" both map to phone): take the first that actually has a value.
    const get = (name: string) => {
      for (const i of columns.get(name) ?? []) {
        const v = (r[i] ?? "").trim();
        if (v) return v;
      }
      return "";
    };
    /** Supplied-or-null, the shape every patch field takes. */
    const opt = (name: string) => get(name) || null;
    // A non-empty cell that isn't a number ("Up to £120,000", "175 sq m") is
    // reported rather than quietly stored as null.
    const num = (name: string) => {
      const raw = get(name);
      const value = numOrNull(raw);
      if (raw && value === null)
        warnings.push(`Row ${rowNo}: ignored ${name} "${raw}" — not a number`);
      return value;
    };
    /**
     * Claim a key for this file. Returns the earlier record when this row is a
     * repeat, in which case the caller merges into it and adds nothing new.
     */
    const claim = (k: string, rec: { patch: object }) => {
      const prior = recordByFileKey.get(k);
      if (prior) {
        mergedInFile++;
        return prior;
      }
      recordByFileKey.set(k, rec);
      return null;
    };
    try {
      if (entity === "companies") {
        const name = get("name");
        if (!name) throw new Error("name is required");
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
        // Recognised words become use-class slugs so they show in the picker;
        // anything else ("brewery") is kept verbatim as a free tag.
        const sectorTags = (() => {
          const raw = list(get("sector_tags"));
          if (raw.length === 0) return null;
          const { slugs, extra } = partitionSectorTags(raw);
          return [...new Set([...slugs, ...extra])];
        })();
        const patch: CompanyImportPatch = {
          name,
          type: get("type") ? oneOf(get("type"), typeSlugs, "other") : null,
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
        };
        const rec: CompanyRecord = {
          address,
          existingId,
          patch,
          fields: {
            name,
            type: oneOf(get("type"), typeSlugs, "other"),
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
        // Key the file-level dedupe on whatever identified the record, so
        // "ABC Ltd" with a CRN on one line and without on another still merge.
        const prior = claim(companyFileKey(existingId, number, name), rec);
        if (prior) mergePatch(prior.patch as CompanyImportPatch, patch);
        else companyRecords.push(rec);
      } else if (entity === "contacts") {
        const firstName = get("first_name");
        if (!firstName) throw new Error("first_name is required");
        const email = emailOrNull(get("email"));
        if (get("email") && !email) {
          warnings.push(`Row ${rowNo}: ignored email "${get("email")}" — not a valid address`);
        }
        const existingId = (email ? contactByEmail.get(key(email)) : undefined) ?? null;
        const address: ParsedAddress = {
          address_line: get("address_line") || null,
          city: get("city") || null,
          postcode: get("postcode") || null,
          county:
            get("county") ||
            deriveCounty({ postcode: get("postcode"), city: get("city") }),
        };
        const patch: ContactImportPatch = {
          firstName,
          lastName: opt("last_name"),
          email,
          phone: opt("phone"),
          role: get("role") ? oneOf(get("role"), roleSlugs, "other") : null,
          companyId: null, // resolved after companies are created, below
          notes: opt("notes"),
          // Only ever true or "leave alone": a blank cell must never silently
          // opt someone out of marketing they previously agreed to.
          marketingOptIn: boolOf(get("marketing_opt_in")) || null,
          addressLine: address.address_line,
          city: address.city,
          postcode: address.postcode,
          county: address.county,
          lat: null,
          lng: null,
        };
        const rec: ContactRecord = {
          address,
          companyName: get("company_name") || null,
          existingId,
          hadEmailMatch: existingId !== null,
          patch,
          fields: {
            firstName,
            lastName: opt("last_name"),
            email,
            phone: opt("phone"),
            role: oneOf(get("role"), roleSlugs, "other"),
            companyId: null, // resolved after companies are created, below
            county: address.county,
            notes: opt("notes"),
            leadAgentId: null,
            marketingOptIn: boolOf(get("marketing_opt_in")),
            addressLine: address.address_line,
            city: address.city,
            postcode: address.postcode,
          },
        };
        // Only the email is a safe in-file key at this point; the name key
        // needs the company, which isn't resolved until below. Name-keyed
        // in-file duplicates are folded in during that later pass.
        const prior = email ? claim(`email:${key(email)}`, rec) : null;
        if (prior) mergePatch(prior.patch as ContactImportPatch, patch);
        else contactRecords.push(rec);
      } else if (entity === "requirements") {
        const title = get("title");
        const externalRef = get("external_ref") || null;
        const contactEmail = get("contact_email");
        const companyName = get("company_name") || null;
        if (contactEmail && !resolveContact(contactEmail)) {
          throw new Error(
            `contact_email "${contactEmail}" doesn't match any contact — import Contacts first`,
          );
        }
        const contactId = resolveContact(contactEmail) ?? null;
        const companyId = companyName
          ? (companyIdByName.get(key(companyName)) ?? null)
          : null;
        if (companyName && !companyId) {
          throw new Error(
            `company_name "${companyName}" doesn't match any company — import Companies first`,
          );
        }
        // Same rule the form enforces, so a spreadsheet can't create rows the
        // UI would reject.
        const invalid = requirementLinkError({ title, companyId, contactId });
        if (invalid) throw new Error(invalid);

        const existingId = externalRef
          ? (requirementIdByRef.get(key(externalRef)) ?? null)
          : null;
        const useClasses = parseUseClasses(get("use_classes"));
        const tenurePrefs = list(get("tenure_prefs")).filter((t) =>
          (Constants.public.Enums.tenure_type as readonly string[]).includes(t),
        );
        const arr = (name: string) => {
          const v = list(get(name));
          return v.length > 0 ? v : null;
        };
        const patch: RequirementImportPatch = {
          title,
          companyId,
          contactId,
          status: get("status")
            ? oneOf(get("status"), Constants.public.Enums.requirement_status, "active")
            : null,
          targetTowns: arr("target_towns"),
          targetRegions: arr("target_regions"),
          targetCounties: arr("target_counties"),
          targetPostcodeDistricts:
            arr("target_postcode_districts")?.map((s) => s.toUpperCase()) ?? null,
          targetNeighbourhoods: arr("target_neighbourhoods"),
          targetLondonZones: arr("target_london_zones"),
          useClasses: useClasses.length > 0 ? useClasses : null,
          tenurePrefs: tenurePrefs.length > 0 ? tenurePrefs : null,
          minSqft: num("min_sqft"),
          maxSqft: num("max_sqft"),
          minCovers: num("min_covers"),
          maxCovers: num("max_covers"),
          maxRent: num("max_rent"),
          maxPremium: num("max_premium"),
          maxGuidePrice: num("max_guide_price"),
          notes: opt("notes"),
        };
        const rec: RequirementRecord = {
          externalRef,
          existingId,
          companyName,
          rowNo,
          patch,
          fields: {
            title,
            companyId,
            contactId,
            status: oneOf(
              get("status"),
              Constants.public.Enums.requirement_status,
              "active",
            ) as RequirementWriteInput["status"],
            targetTowns: list(get("target_towns")),
            targetRegions: list(get("target_regions")),
            targetCounties: list(get("target_counties")),
            targetPostcodeDistricts: list(get("target_postcode_districts")).map((s) =>
              s.toUpperCase(),
            ),
            targetNeighbourhoods: list(get("target_neighbourhoods")),
            targetLondonZones: list(get("target_london_zones")),
            // Cells carry ordinary words ("Bar;Nightclub"), not slugs.
            useClasses: useClasses as RequirementWriteInput["useClasses"],
            tenurePrefs: tenurePrefs as RequirementWriteInput["tenurePrefs"],
            minSqft: num("min_sqft"),
            maxSqft: num("max_sqft"),
            minCovers: num("min_covers"),
            maxCovers: num("max_covers"),
            maxRent: num("max_rent"),
            maxPremium: num("max_premium"),
            maxGuidePrice: num("max_guide_price"),
            notes: opt("notes"),
            leadAgentId: null,
          },
        };
        // Without an external_ref there is nothing to identify the row by, so
        // every such row is a new requirement — that is the documented opt-in.
        const prior = externalRef ? claim(`ref:${key(externalRef)}`, rec) : null;
        if (prior) mergePatch(prior.patch as RequirementImportPatch, patch);
        else requirementRecords.push(rec);
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
        if (prior) mergePatch(prior.patch as DisposalImportPatch, patch);
        else listingRecords.push(rec);
      }
    } catch (e) {
      errors.push(`Row ${rowNo}: ${(e as Error).message}`);
    }
  });

  // Contacts: resolve company_name → company_id, creating minimal companies
  // (case-insensitively de-duped) for names not already in the agency.
  if (entity === "contacts" && contactRecords.length) {
    const newNames = new Map<string, string>();
    for (const c of contactRecords) {
      const nm = c.companyName;
      if (!nm) continue;
      if (!companyIdByName.has(key(nm)) && !newNames.has(key(nm))) newNames.set(key(nm), nm);
    }
    if (newNames.size > 0) {
      for (const name of newNames.values()) {
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
      revalidatePath("/companies");
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
    const byNameThisFile = new Map<string, ContactRecord>();
    const keep: ContactRecord[] = [];
    for (const c of contactRecords) {
      if (c.hadEmailMatch || c.fields.email) {
        keep.push(c);
        continue;
      }
      const k = contactNameKey(c.fields.firstName, c.fields.lastName, c.fields.companyId);
      const priorInFile = byNameThisFile.get(k);
      if (priorInFile) {
        mergePatch(priorInFile.patch, c.patch);
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
  // DAOs take lat/lng as part of the write, not a follow-up update.
  async function geocodeAll<T extends { address: ParsedAddress }>(
    records: T[],
  ): Promise<Map<T, { lat: number | null; lng: number | null }>> {
    const geos = new Map<T, { lat: number | null; lng: number | null }>();
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
  // The neon HTTP driver's sql.transaction() only batches a static array of
  // queries — it can't wrap these multi-step create* calls in one atomic unit
  // without switching to a pooled connection. So instead of risking a mid-loop
  // throw that commits rows 1..N-1 and then 500s the whole action, isolate each
  // row: a failure is recorded and skipped, the rest still import. The result
  // message reports the skips (same pattern as the parse-time `errors`).
  async function writeEach<T extends { existingId: string | null }>(
    records: T[],
    insert: (rec: T) => Promise<unknown>,
    update: (rec: T, id: string) => Promise<unknown>,
  ): Promise<void> {
    for (const rec of records) {
      try {
        if (rec.existingId) {
          await update(rec, rec.existingId);
          updated++;
        } else {
          await insert(rec);
          created++;
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : "row failed to import");
      }
    }
  }

  if (entity === "companies") {
    const geos = await geocodeAll(companyRecords);
    await writeEach(
      companyRecords,
      (rec) =>
        createCompany(agencyId, userId, rec.fields, geos.get(rec) ?? { lat: null, lng: null }),
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
      (rec) =>
        createContact(agencyId, userId, rec.fields, geos.get(rec) ?? { lat: null, lng: null }),
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
      (rec) => createRequirement(agencyId, userId, rec.fields, rec.externalRef),
      (rec, id) => updateRequirementFromImport(agencyId, id, rec.patch),
    );
  } else {
    await writeEach(
      listingRecords,
      (rec) =>
        createDisposal(
          agencyId,
          userId,
          rec.fields,
          { lat: null, lng: null },
          "import",
          rec.externalRef,
        ),
      (rec, id) => updateDisposalFromImport(agencyId, id, rec.patch),
    );
  }

  const path = `/${entity}`;
  revalidatePath(path);

  const skipped = errors.length
    ? ` Skipped ${errors.length}: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "…" : ""}`
    : "";
  // Columns the file carried that we had no home for. Silently dropping these
  // is how a companies file imported 25 names and threw away every address.
  const ignored = header.unrecognised.length
    ? ` Ignored ${header.unrecognised.length} unrecognised column${
        header.unrecognised.length > 1 ? "s" : ""
      }: ${header.unrecognised.join(", ")}.`
    : "";
  const notes = warnings.length
    ? ` ${warnings.length} value${warnings.length > 1 ? "s" : ""} ignored: ${warnings
        .slice(0, 3)
        .join("; ")}${warnings.length > 3 ? "…" : ""}`
    : "";
  const merged = mergedInFile
    ? ` Merged ${mergedInFile} repeated row${mergedInFile > 1 ? "s" : ""} within the file.`
    : "";
  if (!created && !updated && errors.length)
    return { error: `Nothing imported.${skipped}${ignored}${notes}${merged}` };
  // "Added N, updated M" rather than one total: on a re-upload the difference
  // between the two is the whole point of the run.
  const summary = [
    created ? `Added ${created}` : "",
    updated ? `updated ${updated}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return {
    message: `${summary || "No changes"} ${entity}.${skipped}${ignored}${notes}${merged}`,
  };
}
