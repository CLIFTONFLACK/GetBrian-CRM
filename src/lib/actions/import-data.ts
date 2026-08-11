"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { createCompany, type CompanyWriteInput } from "@/lib/db/queries/companies";
import { createContact, type ContactWriteInput } from "@/lib/db/queries/contacts";
import { createDisposal, type DisposalWriteInput } from "@/lib/db/queries/disposals";
import { listCompanyNameMap, listContactEmailMap } from "@/lib/db/queries/import";
import { listCompanyTypes, listContactRoles } from "@/lib/db/queries/lookups";
import { createRequirement, type RequirementWriteInput } from "@/lib/db/queries/requirements";
import { deriveCounty } from "@/lib/locations";
import { addressQuery, geocodeAddress } from "@/lib/maps/geocode";
import { Constants } from "@/lib/database.types";
import { parseCsv, type ImportEntity } from "@/lib/csv";
import {
  formatUseClasses,
  parseUseClasses,
  partitionSectorTags,
  planningClassFor,
} from "@/lib/use-classes";
import type { FormState } from "@/lib/actions/types";

// Reuses each domain's existing create* DAO function
// (createCompany/createContact/createRequirement/createDisposal) rather than
// duplicating insert logic — see AGENTS.md. Every insert here runs one row at
// a time (N sequential round trips for an N-row CSV) rather than a single
// bulk statement: admin CSV import isn't a hot path, and reusing the
// per-domain DAOs (each with its own validation-free insert shape) is worth
// more than the extra round trips.

const ENTITIES: ImportEntity[] = ["companies", "contacts", "requirements", "listings"];
const LISTING_TYPES = ["cdg", "intel"];

const list = (v: string) =>
  v.split(";").map((s) => s.trim()).filter(Boolean);
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
  if (rows.length < 2) {
    return { error: "Need a header row plus at least one data row." };
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const colIdx = (name: string) => header.indexOf(name);

  // Contact roles + company types are editable data now — validate imported
  // values against the live slug lists (fallbacks "other") rather than a fixed enum.
  // Both are system-wide lookups (not agency-scoped — see lookups.ts).
  const roleSlugs = (await listContactRoles()).map((r) => r.slug);
  const typeSlugs = (await listCompanyTypes()).map((t) => t.slug);

  // Every listing and requirement MUST have a contact (mirrors the UI actions).
  // CSV rows carry a `contact_email` that we resolve to an agency contact; rows
  // whose contact_email is missing or unknown are reported and skipped.
  const contactByEmail = await listContactEmailMap(agencyId);
  const resolveContact = (email: string) =>
    email ? contactByEmail.get(email.trim().toLowerCase()) : undefined;

  // Existing companies (agency-scoped) — used to dedupe company imports and to
  // resolve contacts' `company_name` links.
  const companyIdByName =
    entity === "companies" || entity === "contacts"
      ? await listCompanyNameMap(agencyId)
      : new Map<string, string>();

  type CompanyRecord = { address: ParsedAddress; fields: CompanyWriteInput };
  type ContactRecord = {
    address: ParsedAddress;
    fields: ContactWriteInput;
    companyName: string | null;
  };
  type RequirementRecord = RequirementWriteInput;
  type ListingRecord = DisposalWriteInput;

  const companyRecords: CompanyRecord[] = [];
  const contactRecords: ContactRecord[] = [];
  const requirementRecords: RequirementRecord[] = [];
  const listingRecords: ListingRecord[] = [];
  const errors: string[] = [];
  // Case-insensitive dedupe keys (contact emails / company names) seen earlier
  // in this file, so a row duplicated within the CSV itself is skipped too.
  const seenInFile = new Set<string>();

  rows.slice(1).forEach((r, n) => {
    const get = (name: string) => {
      const i = colIdx(name);
      return i >= 0 ? (r[i] ?? "").trim() : "";
    };
    try {
      if (entity === "companies") {
        const name = get("name");
        if (!name) throw new Error("name is required");
        const key = name.toLowerCase();
        if (companyIdByName.has(key))
          throw new Error(`skipped — company "${name}" already exists`);
        if (seenInFile.has(key))
          throw new Error(`skipped — duplicate of an earlier row in this file`);
        seenInFile.add(key);
        const address: ParsedAddress = {
          address_line: get("address_line") || null,
          city: get("city") || null,
          postcode: get("postcode") || null,
          county:
            get("county") ||
            deriveCounty({ postcode: get("postcode"), city: get("city") }),
        };
        companyRecords.push({
          address,
          fields: {
            name,
            type: oneOf(get("type"), typeSlugs, "other"),
            // Recognised words become use-class slugs so they show in the picker;
            // anything else ("brewery") is kept verbatim as a free tag.
            sectorTags: (() => {
              const { slugs, extra } = partitionSectorTags(list(get("sector_tags")));
              return [...new Set([...slugs, ...extra])];
            })(),
            website: get("website") || null,
            phone: get("phone") || null,
            addressLine: address.address_line,
            city: address.city,
            postcode: address.postcode,
            county: address.county,
            notes: get("notes") || null,
            companyNumber: null,
            vatNumber: null,
            leadAgentId: null,
          },
        });
      } else if (entity === "contacts") {
        if (!get("first_name")) throw new Error("first_name is required");
        const email = emailOrNull(get("email"));
        if (email) {
          const key = email.toLowerCase();
          if (contactByEmail.has(key))
            throw new Error(`skipped — a contact with email ${email} already exists`);
          if (seenInFile.has(key))
            throw new Error(`skipped — duplicate of an earlier row in this file`);
          seenInFile.add(key);
        }
        const address: ParsedAddress = {
          address_line: get("address_line") || null,
          city: get("city") || null,
          postcode: get("postcode") || null,
          county:
            get("county") ||
            deriveCounty({ postcode: get("postcode"), city: get("city") }),
        };
        contactRecords.push({
          address,
          companyName: get("company_name") || null,
          fields: {
            firstName: get("first_name"),
            lastName: get("last_name") || null,
            email,
            phone: get("phone") || null,
            role: oneOf(get("role"), roleSlugs, "other"),
            companyId: null, // resolved after companies are created, below
            county: address.county,
            notes: get("notes") || null,
            leadAgentId: null,
            marketingOptIn: boolOf(get("marketing_opt_in")),
            addressLine: address.address_line,
            city: address.city,
            postcode: address.postcode,
          },
        });
      } else if (entity === "requirements") {
        if (!get("title")) throw new Error("title is required");
        const contactId = resolveContact(get("contact_email"));
        if (!contactId)
          throw new Error("contact_email is required and must match an existing contact");
        requirementRecords.push({
          title: get("title"),
          companyId: null,
          contactId,
          status: oneOf(
            get("status"),
            Constants.public.Enums.requirement_status,
            "active",
          ) as RequirementRecord["status"],
          targetTowns: list(get("target_towns")),
          targetRegions: list(get("target_regions")),
          targetCounties: list(get("target_counties")),
          targetPostcodeDistricts: list(get("target_postcode_districts")).map((s) =>
            s.toUpperCase(),
          ),
          targetNeighbourhoods: list(get("target_neighbourhoods")),
          targetLondonZones: list(get("target_london_zones")),
          // Cells carry ordinary words ("Bar;Nightclub"), not slugs.
          useClasses: parseUseClasses(get("use_classes")) as RequirementRecord["useClasses"],
          tenurePrefs: list(get("tenure_prefs")).filter((t) =>
            (Constants.public.Enums.tenure_type as readonly string[]).includes(t),
          ) as RequirementRecord["tenurePrefs"],
          minSqft: numOrNull(get("min_sqft")),
          maxSqft: numOrNull(get("max_sqft")),
          minCovers: numOrNull(get("min_covers")),
          maxCovers: numOrNull(get("max_covers")),
          maxRent: numOrNull(get("max_rent")),
          maxPremium: numOrNull(get("max_premium")),
          maxGuidePrice: numOrNull(get("max_guide_price")),
          notes: get("notes") || null,
          leadAgentId: null,
        });
      } else {
        if (!get("title")) throw new Error("title is required");
        const contactId = resolveContact(get("contact_email"));
        if (!contactId)
          throw new Error("contact_email is required and must match an existing contact");
        const dt = get("disposal_type");
        const lt = get("listing_type");
        // Same derivation as the listing form: the concepts drive both columns.
        // `use_class` is still read as a fallback so an older template that
        // carried "Sui Generis" in that column still lands somewhere sensible.
        const useClasses = parseUseClasses(get("use_classes"), get("use_class"));
        listingRecords.push({
          title: get("title"),
          listingType: LISTING_TYPES.includes(lt) ? lt : "cdg",
          status: get("status") || null,
          disposalType: [
            "freehold",
            "new_lease",
            "lease_assignment",
            "sublease",
            "unknown",
          ].includes(dt)
            ? dt
            : "unknown",
          toLet: false,
          forSale: false,
          addressLine: get("address_line") || null,
          area: get("area") || null,
          city: get("city") || null,
          postcode: get("postcode") || null,
          county:
            get("county") ||
            deriveCounty({ postcode: get("postcode"), city: get("city") }),
          propertyType: useClasses.length > 0 ? formatUseClasses(useClasses) : null,
          useClass:
            useClasses.length > 0 ? planningClassFor(useClasses) : get("use_class") || null,
          sizeSqft: numOrNull(get("size_sqft")),
          sizeSqm: null,
          coversInternal: numOrNull(get("covers_internal")),
          coversExternal: null,
          fitOutState: null,
          epcRating: null,
          tenureRaw: null,
          rentPa: numOrNull(get("rent_pa")),
          premium: numOrNull(get("premium")),
          guidePrice: numOrNull(get("guide_price")),
          rateableValue: null,
          serviceCharge: null,
          keyFeatures: [],
          description: get("description") || null,
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
        });
      }
    } catch (e) {
      errors.push(`Row ${n + 2}: ${(e as Error).message}`);
    }
  });

  // Contacts: resolve company_name → company_id, creating minimal companies
  // (case-insensitively de-duped) for names not already in the agency.
  if (entity === "contacts" && contactRecords.length) {
    const newNames = new Map<string, string>();
    for (const c of contactRecords) {
      const nm = c.companyName;
      if (!nm) continue;
      const key = nm.toLowerCase();
      if (!companyIdByName.has(key) && !newNames.has(key)) newNames.set(key, nm);
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
        companyIdByName.set(name.trim().toLowerCase(), created.id);
      }
      revalidatePath("/companies");
    }
    for (const c of contactRecords) {
      if (c.companyName) c.fields.companyId = companyIdByName.get(c.companyName.toLowerCase()) ?? null;
    }
  }

  // Best-effort geocoding of imported companies/contacts that carry an address
  // (≤5 concurrent lookups; failures are ignored — rows still import, they just
  // won't appear on maps until edited). Runs BEFORE insert since the create*
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

  let inserted = 0;
  // The neon HTTP driver's sql.transaction() only batches a static array of
  // queries — it can't wrap these multi-step create* calls in one atomic unit
  // without switching to a pooled connection. So instead of risking a mid-loop
  // throw that commits rows 1..N-1 and then 500s the whole action, isolate each
  // row: a failure is recorded and skipped, the rest still import. The result
  // message reports the skips (same pattern as the parse-time `errors`).
  async function insertEach<T>(
    records: T[],
    insert: (rec: T) => Promise<unknown>,
  ): Promise<void> {
    for (const rec of records) {
      try {
        await insert(rec);
        inserted++;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : "row failed to import");
      }
    }
  }

  if (entity === "companies") {
    const geos = await geocodeAll(companyRecords);
    await insertEach(companyRecords, (rec) =>
      createCompany(agencyId, userId, rec.fields, geos.get(rec) ?? { lat: null, lng: null }),
    );
  } else if (entity === "contacts") {
    const geos = await geocodeAll(contactRecords);
    await insertEach(contactRecords, (rec) =>
      createContact(agencyId, userId, rec.fields, geos.get(rec) ?? { lat: null, lng: null }),
    );
  } else if (entity === "requirements") {
    await insertEach(requirementRecords, (rec) => createRequirement(agencyId, userId, rec));
  } else {
    await insertEach(listingRecords, (rec) =>
      createDisposal(agencyId, userId, rec, { lat: null, lng: null }, "import"),
    );
  }

  const path = `/${entity}`;
  revalidatePath(path);

  const skipped = errors.length
    ? ` Skipped ${errors.length}: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "…" : ""}`
    : "";
  if (!inserted && errors.length) return { error: `Nothing imported.${skipped}` };
  return { message: `Imported ${inserted} ${entity}.${skipped}` };
}
