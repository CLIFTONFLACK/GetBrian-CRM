"use server";

import { revalidatePath } from "next/cache";

import { currentAgencyId } from "@/lib/supabase/agency";
import { createClient } from "@/lib/supabase/server";
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

const ENTITIES: ImportEntity[] = ["companies", "contacts", "requirements", "listings"];
const LISTING_TYPES = ["cdg", "intel"];
const TABLE: Record<ImportEntity, string> = {
  companies: "companies",
  contacts: "contacts",
  requirements: "requirements",
  listings: "disposals",
};

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

/** Bulk-import CSV rows into companies / contacts / requirements / listings (#8). */
export async function importEntityCsv(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const agencyId = await currentAgencyId(supabase);
  if (!agencyId) return { error: "No agency is linked to your account." };

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
  const { data: roleRows } = await supabase.from("contact_roles").select("slug");
  const roleSlugs = (roleRows ?? []).map((r) => r.slug);
  const { data: typeRows } = await supabase.from("company_types").select("slug");
  const typeSlugs = (typeRows ?? []).map((t) => t.slug);

  // Every listing and requirement MUST have a contact (mirrors the UI actions).
  // CSV rows carry a `contact_email` that we resolve to an agency contact; rows
  // whose contact_email is missing or unknown are reported and skipped.
  const { data: contactRows } = await supabase.from("contacts").select("id, email");
  const contactByEmail = new Map<string, string>();
  for (const c of contactRows ?? []) {
    if (c.email) contactByEmail.set(c.email.trim().toLowerCase(), c.id);
  }
  const resolveContact = (email: string) =>
    email ? contactByEmail.get(email.trim().toLowerCase()) : undefined;

  // Existing companies (RLS-scoped to the agency) — used to dedupe company
  // imports and to resolve contacts' `company_name` links.
  const companyIdByName = new Map<string, string>();
  if (entity === "companies" || entity === "contacts") {
    const { data: companyRows } = await supabase.from("companies").select("id, name");
    for (const c of companyRows ?? []) {
      companyIdByName.set(c.name.trim().toLowerCase(), c.id);
    }
  }

  const base = { agency_id: agencyId, created_by: user.id };
  const records: Record<string, unknown>[] = [];
  const errors: string[] = [];
  // Case-insensitive dedupe keys (contact emails / company names) seen earlier
  // in this file, so a row duplicated within the CSV itself is skipped too.
  const seenInFile = new Set<string>();
  // Contacts only: raw company_name per record (parallel to `records`), resolved
  // to a company_id — creating minimal companies where needed — after parsing.
  const pendingCompanyNames: (string | null)[] = [];

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
        records.push({
          ...base,
          name,
          type: oneOf(get("type"), typeSlugs, "other"),
          // Recognised words become use-class slugs so they show in the picker;
          // anything else ("brewery") is kept verbatim as a free tag.
          sector_tags: (() => {
            const { slugs, extra } = partitionSectorTags(list(get("sector_tags")));
            return [...new Set([...slugs, ...extra])];
          })(),
          website: get("website") || null,
          phone: get("phone") || null,
          address_line: get("address_line") || null,
          city: get("city") || null,
          postcode: get("postcode") || null,
          county:
            get("county") ||
            deriveCounty({ postcode: get("postcode"), city: get("city") }),
          notes: get("notes") || null,
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
        records.push({
          ...base,
          first_name: get("first_name"),
          last_name: get("last_name") || null,
          email,
          phone: get("phone") || null,
          role: oneOf(get("role"), roleSlugs, "other"),
          address_line: get("address_line") || null,
          city: get("city") || null,
          postcode: get("postcode") || null,
          county:
            get("county") ||
            deriveCounty({ postcode: get("postcode"), city: get("city") }),
          marketing_opt_in: boolOf(get("marketing_opt_in")),
          notes: get("notes") || null,
        });
        pendingCompanyNames.push(get("company_name") || null);
      } else if (entity === "requirements") {
        if (!get("title")) throw new Error("title is required");
        const contactId = resolveContact(get("contact_email"));
        if (!contactId)
          throw new Error("contact_email is required and must match an existing contact");
        records.push({
          ...base,
          title: get("title"),
          contact_id: contactId,
          status: oneOf(get("status"), Constants.public.Enums.requirement_status, "active"),
          target_towns: list(get("target_towns")),
          target_regions: list(get("target_regions")),
          target_counties: list(get("target_counties")),
          target_postcode_districts: list(get("target_postcode_districts")).map((s) =>
            s.toUpperCase(),
          ),
          target_neighbourhoods: list(get("target_neighbourhoods")),
          target_london_zones: list(get("target_london_zones")),
          // Cells carry ordinary words ("Bar;Nightclub"), not slugs.
          use_classes: parseUseClasses(get("use_classes")),
          tenure_prefs: list(get("tenure_prefs")).filter((t) =>
            (Constants.public.Enums.tenure_type as readonly string[]).includes(t),
          ),
          min_sqft: numOrNull(get("min_sqft")),
          max_sqft: numOrNull(get("max_sqft")),
          min_covers: numOrNull(get("min_covers")),
          max_covers: numOrNull(get("max_covers")),
          max_rent: numOrNull(get("max_rent")),
          max_premium: numOrNull(get("max_premium")),
          max_guide_price: numOrNull(get("max_guide_price")),
          notes: get("notes") || null,
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
        records.push({
          ...base,
          source: "import",
          title: get("title"),
          contact_id: contactId,
          listing_type: LISTING_TYPES.includes(lt) ? lt : "cdg",
          status: get("status") || null,
          disposal_type: ["freehold", "new_lease", "lease_assignment", "sublease", "unknown"].includes(dt)
            ? dt
            : "unknown",
          address_line: get("address_line") || null,
          area: get("area") || null,
          city: get("city") || null,
          postcode: get("postcode") || null,
          county:
            get("county") ||
            deriveCounty({ postcode: get("postcode"), city: get("city") }),
          property_type: useClasses.length > 0 ? formatUseClasses(useClasses) : null,
          use_class: useClasses.length > 0 ? planningClassFor(useClasses) : get("use_class") || null,
          size_sqft: numOrNull(get("size_sqft")),
          covers_internal: numOrNull(get("covers_internal")),
          rent_pa: numOrNull(get("rent_pa")),
          premium: numOrNull(get("premium")),
          guide_price: numOrNull(get("guide_price")),
          description: get("description") || null,
        });
      }
    } catch (e) {
      errors.push(`Row ${n + 2}: ${(e as Error).message}`);
    }
  });

  // Contacts: resolve company_name → company_id, creating minimal companies
  // (case-insensitively de-duped) for names not already in the agency.
  if (entity === "contacts" && records.length) {
    const newNames = new Map<string, string>();
    for (const nm of pendingCompanyNames) {
      if (!nm) continue;
      const key = nm.toLowerCase();
      if (!companyIdByName.has(key) && !newNames.has(key)) newNames.set(key, nm);
    }
    if (newNames.size > 0) {
      const { data: createdCompanies, error } = await supabase
        .from("companies")
        .insert(
          [...newNames.values()].map((name) => ({
            ...base,
            name,
            type: "other",
          })) as never,
        )
        .select("id, name");
      if (error) {
        return { error: `Could not create companies for company_name: ${error.message}` };
      }
      for (const c of (createdCompanies ?? []) as { id: string; name: string }[]) {
        companyIdByName.set(c.name.trim().toLowerCase(), c.id);
      }
      revalidatePath("/companies");
    }
    records.forEach((rec, i) => {
      const nm = pendingCompanyNames[i];
      if (nm) rec.company_id = companyIdByName.get(nm.toLowerCase()) ?? null;
    });
  }

  type InsertedRow = {
    id: string;
    address_line: string | null;
    city: string | null;
    postcode: string | null;
  };

  let inserted = 0;
  let insertedRows: InsertedRow[] = [];
  if (records.length) {
    if (entity === "companies" || entity === "contacts") {
      // Return address parts so imported rows can be geocoded below.
      const { data: ins, error } = await supabase
        .from(TABLE[entity] as never)
        .insert(records as never)
        .select("id, address_line, city, postcode");
      if (error) return { error: error.message };
      insertedRows = (ins ?? []) as unknown as InsertedRow[];
    } else {
      const { error } = await supabase
        .from(TABLE[entity] as never)
        .insert(records as never);
      if (error) return { error: error.message };
    }
    inserted = records.length;
  }

  // Best-effort geocoding of imported companies/contacts that carry an address
  // (≤5 concurrent lookups; failures are ignored — rows still import, they just
  // won't appear on maps until edited).
  const geoTargets = insertedRows.filter((row) => addressQuery(row));
  if (geoTargets.length > 0) {
    let next = 0;
    const worker = async () => {
      while (next < geoTargets.length) {
        const row = geoTargets[next++];
        try {
          const geo = await geocodeAddress(row);
          if (geo) {
            await supabase
              .from(TABLE[entity] as never)
              .update(geo as never)
              .eq("id", row.id);
          }
        } catch {
          // best-effort only
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(5, geoTargets.length) }, () => worker()),
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
