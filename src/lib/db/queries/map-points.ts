import { sql } from "@/lib/db/client";
import type { MapKind, MapLayers, MapPoint } from "@/components/concentration-map";

// Neon equivalent of src/lib/supabase/map-points.ts's getMapLayers — used by
// the /dashboard, /listings and /map pages (see AGENTS.md). The old
// Supabase version is left in place unused rather than deleted (Storage
// modules under src/lib/supabase/ stay until Phase 5; this one just happens
// to live alongside them and nothing else imports it after this batch).

type ImageItem = { url: string; alt?: string | null };

type Addr = {
  address_line: string | null;
  city: string | null;
  postcode: string | null;
};
const addressOf = (a: Addr) =>
  [a.address_line, a.city, a.postcode].filter(Boolean).join(", ");

type DisposalRow = {
  id: string;
  title: string | null;
  status: string | null;
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  images: unknown;
  lat: number | null;
  lng: number | null;
};
type CompanyRow = {
  id: string;
  name: string;
  type: string;
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
};
type ContactRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  role: string;
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  company_id: string | null;
};

/**
 * Build the geocoded map layers (listings / companies / contacts) for the
 * ConcentrationMap. Shared by the /map page (needs all three) and the
 * per-record list pages (each only renders its own category) — pass
 * `include` to skip querying tables the caller won't render. Contacts
 * without their own coords fall back to their company's pin, so companies
 * are still fetched (but not returned) whenever contacts are requested.
 * Scoped by agencyId — there is no RLS backstop on this schema (see
 * AGENTS.md), so this filter IS the tenant boundary.
 */
export async function getMapLayers(
  agencyId: string,
  opts: { include?: MapKind[] } = {},
): Promise<MapLayers> {
  const include = new Set(opts.include ?? ["listing", "company", "contact"]);
  const wantListings = include.has("listing");
  const wantContacts = include.has("contact");
  // Company rows are also needed (but not returned) to resolve the
  // contact-falls-back-to-company-pin case.
  const wantCompanyRows = include.has("company") || wantContacts;

  const [disposals, companies, contacts] = await Promise.all([
    wantListings
      ? ((await sql`
          select id, title, status, address_line, city, postcode, images, lat, lng
          from public.disposals
          where agency_id = ${agencyId}
        `) as DisposalRow[])
      : Promise.resolve([] as DisposalRow[]),
    wantCompanyRows
      ? ((await sql`
          select id, name, type, address_line, city, postcode, lat, lng
          from public.companies
          where agency_id = ${agencyId}
        `) as CompanyRow[])
      : Promise.resolve([] as CompanyRow[]),
    wantContacts
      ? ((await sql`
          select id, first_name, last_name, role, address_line, city, postcode, lat, lng, company_id
          from public.contacts
          where agency_id = ${agencyId}
        `) as ContactRow[])
      : Promise.resolve([] as ContactRow[]),
  ]);

  const companyCoord = new Map<string, { lat: number; lng: number; address: string }>();
  for (const c of companies) {
    if (c.lat != null && c.lng != null) {
      companyCoord.set(c.id, { lat: c.lat, lng: c.lng, address: addressOf(c) });
    }
  }

  const listings: MapPoint[] = disposals
    .filter((d) => d.lat != null && d.lng != null)
    .map((d) => ({
      id: d.id,
      kind: "listing",
      name: d.title ?? "Untitled listing",
      subtitle: d.status,
      address: addressOf(d),
      image: (Array.isArray(d.images) ? (d.images as ImageItem[])[0]?.url : null) ?? null,
      lat: d.lat as number,
      lng: d.lng as number,
    }));

  const companyPoints: MapPoint[] = companies
    .filter((c) => c.lat != null && c.lng != null)
    .map((c) => ({
      id: c.id,
      kind: "company",
      name: c.name,
      subtitle: c.type,
      address: addressOf(c),
      lat: c.lat as number,
      lng: c.lng as number,
    }));

  const contactPoints: MapPoint[] = contacts
    .map((c): MapPoint | null => {
      const own = c.lat != null && c.lng != null;
      const fallback = !own && c.company_id ? companyCoord.get(c.company_id) : undefined;
      if (!own && !fallback) return null;
      return {
        id: c.id,
        kind: "contact",
        name: [c.first_name, c.last_name].filter(Boolean).join(" "),
        subtitle: c.role,
        address: own ? addressOf(c) : (fallback?.address ?? null),
        lat: own ? (c.lat as number) : fallback!.lat,
        lng: own ? (c.lng as number) : fallback!.lng,
      };
    })
    .filter((p): p is MapPoint => p !== null);

  return {
    listings,
    companies: include.has("company") ? companyPoints : [],
    contacts: contactPoints,
  };
}
