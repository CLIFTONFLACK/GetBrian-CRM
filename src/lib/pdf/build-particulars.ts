import { createElement, type ReactElement } from "react";

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";

import {
  getDisposalById,
  getDisposalAgentIds,
  getUserNames,
  listDisposalAreas,
} from "@/lib/db/queries/disposals";
import { staticMapUrl } from "@/lib/maps/static-map";
import { registerBrandFonts } from "@/lib/pdf/fonts";
import {
  ParticularsDocument,
  type ParticularsData,
  type DocSection,
  type FloorRow,
} from "@/lib/pdf/particulars-document";

type ImageItem = { url: string; alt?: string | null };

const money = (v: number | null) =>
  v != null ? `£${Number(v).toLocaleString("en-GB")}` : null;

// Section titles already rendered from dedicated columns — drop duplicates that
// the marketing scrape may also carry, so they aren't printed twice.
const COVERED = /^(summary|description|location|accommodation|tenure|asking\s*rent|rent|premium|vat|planning|licen[cs]|confidential|holding\s*deposit|key\s*features?)/i;

async function fetchHero(images: ImageItem[]): Promise<Buffer | null> {
  const url = images[0]?.url;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// Static Maps PNG of the listing location (null when no coords or no server key).
async function fetchStaticMap(
  lat: number | null,
  lng: number | null,
): Promise<Buffer | null> {
  if (lat == null || lng == null) return null;
  const url = staticMapUrl(lat, lng);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

type AreaRow = { name: string; size_sqft: number | null; size_sqm: number | null };

function buildData(
  d: Record<string, unknown>,
  hero: Buffer | null,
  map: Buffer | null,
  agents: string[],
  areas: AreaRow[],
): ParticularsData {
  const g = <T,>(k: string) => d[k] as T;

  const toLet = g<boolean>("to_let");
  const forSale = g<boolean>("for_sale");
  const statusTag =
    toLet && forSale ? "To Let / For Sale" : forSale ? "For Sale" : "To Let";

  const postcode = g<string | null>("postcode");
  const address = [g<string | null>("address_line"), g<string | null>("city"), postcode]
    .filter(Boolean)
    .join(", ");

  const sqft = g<number | null>("size_sqft");
  const sqm = g<number | null>("size_sqm");
  const sizeLine = sqft != null ? `${sqft.toLocaleString("en-GB")} sq ft` : null;
  const sizeSub = sqm != null ? `(${sqm.toLocaleString("en-GB")} sq m)` : null;

  // Premium: prefer the raw scrape text; fall back to the numeric value.
  const premiumRaw = g<string | null>("premium_raw");
  const premiumNum = g<number | null>("premium");
  const isNilPremium =
    premiumNum === 0 || (premiumRaw != null && /\bnil\b/i.test(premiumRaw));
  const premium = premiumRaw ?? (isNilPremium ? "Nil" : money(premiumNum));
  const premiumTag = isNilPremium
    ? "NIL PREMIUM"
    : premiumNum != null && premiumNum > 0
      ? `${money(premiumNum)} PREMIUM`
      : null;

  // Asking rent: prefer raw text, else compose from numeric fields.
  const rentRaw = g<string | null>("rent_raw");
  const rentPa = g<number | null>("rent_pa");
  const rentPeriod = g<string | null>("rent_period");
  const askingRent =
    rentRaw ??
    (rentPa != null
      ? `${money(rentPa)} ${rentPeriod ?? "per annum"} exclusive.`
      : null);

  const rawSections = (Array.isArray(d.sections) ? d.sections : []) as DocSection[];
  const sections = rawSections.filter(
    (s) => s?.title && s?.content && !COVERED.test(s.title.trim()),
  );

  return {
    intel: g<string | null>("listing_type") === "intel",
    statusTag,
    title: g<string | null>("title") ?? "Property",
    address,
    postcode,
    premiumTag,
    summary: g<string | null>("summary"),
    sizeLine,
    sizeSub,
    keyFeatures: (g<string[] | null>("key_features") ?? []).filter(Boolean),
    availableSize: sizeLine,
    epc: g<string | null>("epc_rating"),
    description: g<string | null>("description"),
    location: g<string | null>("location_description"),
    // Accommodation table: scraped `floors` when present, otherwise the
    // manually-maintained disposal_areas schedule (previously never reached
    // the PDF, leaving manual listings without a floor table).
    floors: (() => {
      const scraped = (Array.isArray(d.floors) ? d.floors : []) as FloorRow[];
      if (scraped.length > 0) return scraped;
      return areas.map((a) => ({
        name: a.name,
        sqft: a.size_sqft,
        sqm: a.size_sqm,
      }));
    })(),
    tenure: g<string | null>("tenure_raw"),
    askingRent,
    premium,
    vat: g<boolean | null>("vat_applicable")
      ? "May be applicable to the premium and rent."
      : null,
    licensing: g<string | null>("licensing_notes"),
    sections,
    agentName: g<string | null>("agent_name"),
    agentPhone: g<string | null>("agent_phone"),
    agentEmail: g<string | null>("agent_email"),
    agents,
    generatedOn: new Date().toLocaleDateString("en-GB"),
    heroImage: hero,
    mapImage: map,
  };
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "particulars";

/**
 * Renders the particulars PDF for a disposal. Branded for CDG listings,
 * unbranded when `listing_type = 'intel'` (handled inside ParticularsDocument).
 * Returns null when the disposal doesn't exist in this agency — `agencyId`
 * IS the visibility check now that there's no RLS backstop (see AGENTS.md).
 */
export async function renderParticularsPdf(
  agencyId: string,
  disposalId: string,
): Promise<{ buffer: Buffer; filename: string; isIntel: boolean } | null> {
  const row = await getDisposalById(agencyId, disposalId);
  if (!row) return null;

  // Internal CDG team assigned to this listing (lead first, then collaborators).
  const agentUserIds = await getDisposalAgentIds(agencyId, disposalId);
  const orderedIds = [row.lead_agent_id, ...agentUserIds].filter(
    (v): v is string => Boolean(v),
  );
  let agentNames: string[] = [];
  if (orderedIds.length) {
    // `public.users` replaces the old `profiles` table (merged in
    // db/migrations/0001_init.sql) — see getUserNames's own doc comment.
    const nameOf = await getUserNames([...new Set(orderedIds)]);
    const seen = new Set<string>();
    agentNames = orderedIds
      .filter((uid) => !seen.has(uid) && seen.add(uid))
      .map((uid) => nameOf.get(uid) ?? "Agent");
  }

  registerBrandFonts();
  const images = (Array.isArray(row.images) ? row.images : []) as ImageItem[];
  const [hero, map, areaRows] = await Promise.all([
    fetchHero(images),
    fetchStaticMap(row.lat, row.lng),
    // Manually-maintained area schedule — the accommodation-table fallback
    // when the row carries no scraped `floors`.
    listDisposalAreas(agencyId, disposalId),
  ]);
  const data = buildData(
    row as unknown as Record<string, unknown>,
    hero,
    map,
    agentNames,
    areaRows,
  );

  // ParticularsDocument renders a <Document> at runtime; createElement loses
  // that in the type system, so assert the element shape renderToBuffer wants.
  const element = createElement(ParticularsDocument, {
    d: data,
  }) as unknown as ReactElement<DocumentProps>;
  const pdf = await renderToBuffer(element);

  return {
    buffer: Buffer.from(pdf),
    filename: `${slug(data.title)}-particulars.pdf`,
    isIntel: data.intel,
  };
}
