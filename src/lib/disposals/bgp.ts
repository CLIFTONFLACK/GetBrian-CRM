/**
 * Bruce Gillingham Pollard (brucegillinghampollard.com) → `disposals`
 * extractor — West End / City retail and leisure agency.
 *
 * A bespoke WordPress theme with unusually clean, fully server-rendered markup:
 *
 *  - List page `/listings/` — the whole book on one page, one
 *    `<article class="tile">` per unit wrapping the detail link, a headline and
 *    a Swiper gallery. Status is written into the headline
 *    ("Under Offer – Weybridge Hall KT13 8DX").
 *  - Detail page `/listings/<slug>/` — `h1.listing-headline`, a `.meta` size
 *    line, a `.standfirst` summary, a `<dl>` of Size / Accommodation / Tenure /
 *    Rent / Rates Payable / Use / EPC …, and a `.map[data-lat][data-lng]`.
 *
 * The detail page renders only the hero image (the gallery is hydrated client
 * side), so each card's `<img>` set is carried across as `hints.images`.
 */

import {
  type DisposalInsert,
  parseCovers,
  parseEpc,
  parseLease,
  parseMoney,
  parsePriceQualifier,
  parseUseClass,
} from "./cdg.ts";
import {
  type IntelListing,
  applyHints,
  deriveFitOut,
  extractPhone,
  extractPostcode,
  fetchHtml,
  htmlToLine,
  htmlToText,
  parseSizeSqft,
  rentPeriodFor,
  resolveDisposalType,
  ScrapeError,
  splitAddressTitle,
  splitStatusPrefix,
  stripNoise,
  unique,
} from "./scrape-utils.ts";

export const BGP_SOURCE = "bgp";
export const BGP_BASE = "https://www.brucegillinghampollard.com";
export const BGP_LIST_URL = `${BGP_BASE}/listings/`;

// ─────────────────────────────────────────────────────────────────────────────
// List page — the whole book, one page, with each card's gallery.
// ─────────────────────────────────────────────────────────────────────────────

export function extractBgpListings(html: string): IntelListing[] {
  const listings = new Map<string, IntelListing>();
  const cards = stripNoise(html).matchAll(
    /<article\b[^>]*class="[^"]*\btile\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi,
  );
  for (const card of cards) {
    const body = card[1];
    const href = body.match(new RegExp(`href="(${BGP_BASE}/listings/[a-z0-9-]+/)"`, "i"));
    if (!href) continue;
    const images = unique(
      [...body.matchAll(/<img[^>]+src="([^"]+\.(?:jpe?g|png|webp))"/gi)].map((m) => m[1]),
    ).map((url) => ({ url, alt: null }));
    listings.set(href[1], {
      url: href[1],
      ...(images.length ? { hints: { images } } : {}),
    });
  }
  return [...listings.values()];
}

export async function fetchBgpListings(init?: {
  signal?: AbortSignal;
}): Promise<IntelListing[]> {
  const listings = extractBgpListings(await fetchHtml(BGP_LIST_URL, init));
  if (listings.length === 0) {
    throw new ScrapeError(
      "No Bruce Gillingham Pollard listings found — the page structure may have changed.",
    );
  }
  return listings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail page → DisposalInsert.
// ─────────────────────────────────────────────────────────────────────────────

/** The `<dl>` under `section.details` as a lowercased label → text map. */
function parseDetailList(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const dl = html.match(/<dl\b[^>]*>([\s\S]*?)<\/dl>/i);
  if (!dl) return out;
  const pairs = dl[1].matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi);
  for (const p of pairs) {
    const key = htmlToLine(p[1]).replace(/:$/, "").toLowerCase();
    const value = htmlToText(p[2]);
    if (key && value) out.set(key, value);
  }
  return out;
}

export function mapBgpToDisposal(html: string, listing: IntelListing): DisposalInsert {
  const page = stripNoise(html);
  const headline = page.match(
    /<h1[^>]*class="[^"]*listing-headline[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  if (!headline) {
    throw new ScrapeError(`No listing headline found at ${listing.url}`);
  }
  const { title, status } = splitStatusPrefix(htmlToLine(headline[1]));

  const details = parseDetailList(page);
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = details.get(k);
      if (v) return v;
    }
    return null;
  };

  const standfirst = page.match(
    /<div[^>]*class="[^"]*listing-standfirst[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const summary = standfirst ? htmlToText(standfirst[1]) : null;

  const headerSize = page.match(/<div[^>]*class="meta"[^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/i);
  const sizeText = get("size") ?? (headerSize ? htmlToLine(headerSize[1]) : null);

  const rentText = get("rent", "rent payable");
  const priceText = get("price", "guide price");
  const premiumText = get("premium");
  const tenureText = get("tenure", "lease", "basis of offer");
  const useText = get("use", "planning", "use class");
  const accommodation = get("accommodation");

  // Every dt/dd survives verbatim — the labels vary per instruction and none of
  // them should be silently dropped on the way into the CRM.
  const sections = [...details.entries()].map(([k, v]) => ({
    title: k.replace(/\b[a-z]/g, (c) => c.toUpperCase()),
    content: v,
  }));

  const description = [summary, accommodation].filter(Boolean).join("\n\n") || null;
  const searchable = [title, description, ...sections.map((s) => s.content)]
    .filter(Boolean)
    .join("\n");

  const coords = page.match(/data-lat="([-\d.]+)"[\s\S]{0,80}?data-lng="([-\d.]+)"/i);
  const lat = coords ? Number(coords[1]) : null;
  const lng = coords ? Number(coords[2]) : null;

  const hero = page.match(
    /<figure[^>]*class="[^"]*listing-hero[^"]*"[^>]*>\s*<img[^>]+src="([^"]+)"/i,
  );
  const gallery = unique(
    [
      ...(hero ? [hero[1]] : []),
      ...[...page.matchAll(/<aside[^>]*class="listing-images"[^>]*>([\s\S]*?)<\/aside>/gi)]
        .flatMap((a) => [...a[1].matchAll(/<img[^>]+src="([^"]+)"/gi)])
        .map((m) => m[1]),
    ].filter((u) => /\.(jpe?g|png|webp)$/i.test(u)),
  ).map((url) => ({ url, alt: null }));

  // Brochure: a labelled PDF in the header links. The "Goad" plan that sits in
  // the same list is an Experian retail map, not particulars — leave it out.
  const brochure = [
    ...page.matchAll(/<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi),
  ].find((m) => /brochure|particulars|details|download/i.test(htmlToLine(m[2])));

  // Agent contacts are entity-obfuscated in the markup ("m&#97;&#105;&#108;to:…"),
  // so decode the whole href before looking for the scheme.
  const agentEmail =
    [...page.matchAll(/<a[^>]+href="([^"]+)"/gi)]
      .map((m) => htmlToLine(m[1]))
      .find((href) => /^mailto:/i.test(href))
      ?.replace(/^mailto:/i, "")
      .split("?")[0] ?? null;
  const whatsapp = page.match(/api\.whatsapp\.com\/send\?phone=([^"&]+)/i);

  const { addressLine, city, postcode } = splitAddressTitle(title);
  const rentPa = parseMoney(rentText);
  const forSale = priceText != null && rentText == null;
  const covers = parseCovers(searchable);

  return applyHints(
    {
      source: BGP_SOURCE,
      source_ref: listing.url.replace(/\/+$/, "").split("/").pop() ?? listing.url,
      source_url: listing.url,
      status,
      source_updated_at: null,

      title,
      summary,
      address_line: addressLine,
      area: null,
      city,
      postcode: postcode ?? extractPostcode(searchable, { fullOnly: true }),
      lat: lat != null && Number.isFinite(lat) ? lat : null,
      lng: lng != null && Number.isFinite(lng) ? lng : null,

      property_type: null,
      use_class: parseUseClass(useText, searchable),
      disposal_type: resolveDisposalType(forSale ? "for-sale" : "to-let", tenureText),
      to_let: !forSale,
      for_sale: forSale,

      rent_pa: rentPa,
      rent_raw: rentText,
      rent_period: rentPeriodFor(rentText, rentPa),
      premium: premiumText != null && /\bnil\b/i.test(premiumText) ? 0 : parseMoney(premiumText),
      premium_raw: premiumText,
      guide_price: parseMoney(priceText),
      price_qualifier: parsePriceQualifier(premiumText, rentText, priceText),
      vat_applicable: null,
      rateable_value: parseMoney(get("rateable value")),
      business_rates: parseMoney(get("rates payable", "business rates")),
      service_charge: parseMoney(get("service charge")),
      estate_charge: null,
      parking_charge: null,

      tenure_raw: tenureText,
      ...parseLease(tenureText),
      next_rent_review: null,

      size_sqft: parseSizeSqft(sizeText),
      size_sqm: null,
      covers_internal: covers.internal,
      covers_external: covers.external,
      floors: [],

      licensing_notes: get("licence", "licensing", "premises licence"),
      fit_out_state: deriveFitOut(searchable),
      epc_rating: parseEpc(get("epc")),

      description,
      location_description: null,
      key_features: [],
      sections,

      agent_name: null,
      agent_email: agentEmail,
      agent_phone: whatsapp ? extractPhone(decodeURIComponent(whatsapp[1])) : null,
      agent_photo: null,

      images: gallery,
      brochure_url: brochure ? brochure[1] : null,
    },
    listing.hints,
    ["images"],
  );
}

export async function fetchAndExtractBgp(
  listing: IntelListing,
  init?: { signal?: AbortSignal },
): Promise<DisposalInsert> {
  return mapBgpToDisposal(await fetchHtml(listing.url, init), listing);
}
