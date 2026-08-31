/**
 * Restaurant Property (restaurant-property.co.uk) → `disposals` extractor.
 *
 * Concrete CMS. `/properties` renders **two** page-list blocks stacked on one
 * template and they are not equivalent:
 *
 *  - block `b993` — the named book. Each card links to a real
 *    `/properties/<slug>` detail page with address, size, rent and a brochure.
 *  - block `b994` — a much larger anonymised archive ("Hotel - Mayfair",
 *    "15,000 + sq ft") with no address and no detail page; every card points at
 *    a "Request More Info" registration form.
 *
 * Only `b993` is scraped. The anonymous block would add thousands of rows that
 * carry no address, no price and nothing to match a requirement against — that
 * is not market intel, it is a mailing-list funnel.
 *
 * Paging is `?ccm_paging_p_b993=N`, and Concrete clamps out-of-range pages back
 * to page 1 rather than 404ing, so the walk stops when a page adds nothing new.
 *
 * Detail page: `<h1>` headline, a `.property_detail_highlight` block of
 * "Use / Total Size / Rent / Lease / Premium" spans, an
 * `<h2>Property Description</h2>` body and a `/download_file/…` brochure.
 */

import {
  type DisposalInsert,
  parseCovers,
  parseLease,
  parseMoney,
  parsePriceQualifier,
  parseUseClass,
} from "./cdg.ts";
import {
  type IntelListing,
  applyHints,
  deriveFitOut,
  extractPostcode,
  fetchHtml,
  htmlToLine,
  htmlToText,
  parseSizeSqft,
  rentPeriodFor,
  resolveDisposalType,
  ScrapeError,
  splitAddressTitle,
  stripNoise,
  unique,
} from "./scrape-utils.ts";

export const RESTAURANTPROPERTY_SOURCE = "restaurantproperty";
export const RESTAURANTPROPERTY_BASE = "https://www.restaurant-property.co.uk";
/** The named-book page-list block on /properties. */
const NAMED_BLOCK = "b993";
const MAX_PAGES = 15;

// ─────────────────────────────────────────────────────────────────────────────
// List pages.
// ─────────────────────────────────────────────────────────────────────────────

export function extractRestaurantPropertyUrls(html: string): string[] {
  return unique(
    [
      ...html.matchAll(
        /https:\/\/www\.restaurant-property\.co\.uk\/properties\/[a-z0-9-]+/gi,
      ),
    ].map((m) => m[0]),
  );
}

export async function fetchRestaurantPropertyListings(init?: {
  signal?: AbortSignal;
  maxPages?: number;
}): Promise<IntelListing[]> {
  const all = new Set<string>();
  const maxPages = init?.maxPages ?? MAX_PAGES;
  for (let page = 1; page <= maxPages; page++) {
    const url =
      page === 1
        ? `${RESTAURANTPROPERTY_BASE}/properties`
        : `${RESTAURANTPROPERTY_BASE}/properties?ccm_paging_p_${NAMED_BLOCK}=${page}`;
    const html = await fetchHtml(url, init);
    const before = all.size;
    for (const u of extractRestaurantPropertyUrls(html)) all.add(u);
    // Concrete serves page 1 again once N exceeds the last page, so "no new
    // URLs" is the only reliable end-of-book signal.
    if (all.size === before) break;
  }
  if (all.size === 0) {
    throw new ScrapeError(
      "No Restaurant Property listings found — the page structure may have changed.",
    );
  }
  return [...all].map((url) => ({ url }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail page → DisposalInsert.
// ─────────────────────────────────────────────────────────────────────────────

/** `<span><strong>Rent: </strong>£430,000 per annum</span>` pairs. */
function parseHighlights(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const block = html.match(
    /<div[^>]*class="[^"]*property_detail_highlight[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
  );
  if (!block) return out;
  for (const m of block[1].matchAll(
    /<strong>([^<]+?)\s*:?\s*<\/strong>([\s\S]*?)(?=<span|<\/p>|$)/gi,
  )) {
    const key = htmlToLine(m[1]).replace(/:$/, "").toLowerCase();
    const value = htmlToLine(m[2]);
    if (key && value) out.set(key, value);
  }
  return out;
}

export function mapRestaurantPropertyToDisposal(
  html: string,
  listing: IntelListing,
): DisposalInsert {
  const page = stripNoise(html);
  const titleMatch = page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!titleMatch) {
    throw new ScrapeError(`No property title found at ${listing.url}`);
  }
  const title = htmlToLine(titleMatch[1]);

  const highlights = parseHighlights(page);
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = highlights.get(k);
      if (v) return v;
    }
    return null;
  };

  const descMatch = page.match(
    /<h2>\s*Property Description\s*<\/h2>([\s\S]*?)<div class="row">/i,
  );
  const description = descMatch ? htmlToText(descMatch[1]) || null : null;

  const useText = get("use");
  const sizeText = get("total size", "size");
  const rentText = get("rent");
  const leaseText = get("lease", "tenure");
  const premiumText = get("premium");
  const priceText = get("price", "guide price");

  const searchable = [title, description, ...highlights.values()]
    .filter(Boolean)
    .join("\n");

  const images = unique(
    [
      ...page.matchAll(
        /<img[^>]+src="((?:https:\/\/www\.restaurant-property\.co\.uk)?\/application\/files\/thumbnails\/msm_slider\/[^"]+)"/gi,
      ),
    ].map((m) =>
      m[1].startsWith("http") ? m[1] : `${RESTAURANTPROPERTY_BASE}${m[1]}`,
    ),
  ).map((url) => ({ url, alt: null }));

  const brochure = page.match(
    /<a[^>]+href="([^"]*\/download_file\/[^"]+)"[^>]*title="Brochure"/i,
  );

  // Headlines follow "Address, Town - Descriptor" ("Mayfair, London - Cafe/
  // Bar"). Only the part before the dash is a location; without this the town
  // facet grows an entry called "London - Cafe/ Bar".
  const locationPart = title.split(/\s+[-–—]\s+/)[0] ?? title;
  const { addressLine, city, postcode } = splitAddressTitle(locationPart);
  const rentPa = parseMoney(rentText);
  const forSale = /freehold/i.test(`${leaseText ?? ""} ${searchable}`) && rentText == null;
  const covers = parseCovers(searchable);

  return applyHints(
    {
      source: RESTAURANTPROPERTY_SOURCE,
      source_ref: listing.url.replace(/\/+$/, "").split("/").pop() ?? listing.url,
      source_url: listing.url,
      status: "Available",
      source_updated_at: null,

      title,
      summary: description ? description.split("\n")[0] : null,
      address_line: addressLine,
      area: null,
      city,
      postcode: postcode ?? extractPostcode(searchable, { fullOnly: true }),
      lat: null,
      lng: null,

      property_type: useText,
      use_class: parseUseClass(useText, searchable),
      disposal_type: resolveDisposalType(forSale ? "for-sale" : "to-let", leaseText, searchable),
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
      rateable_value: null,
      business_rates: null,
      service_charge: null,
      estate_charge: null,
      parking_charge: null,

      tenure_raw: leaseText,
      ...parseLease(leaseText),
      next_rent_review: null,

      size_sqft: parseSizeSqft(sizeText),
      size_sqm: null,
      covers_internal: covers.internal,
      covers_external: covers.external,
      floors: [],

      licensing_notes: null,
      fit_out_state: deriveFitOut(searchable),
      epc_rating: null,

      description,
      location_description: null,
      key_features: [],
      sections: [...highlights.entries()].map(([k, v]) => ({
        title: k.replace(/\b[a-z]/g, (c) => c.toUpperCase()),
        content: v,
      })),

      agent_name: null,
      agent_email: null,
      agent_phone: null,
      agent_photo: null,

      images,
      brochure_url: brochure
        ? brochure[1].startsWith("http")
          ? brochure[1]
          : `${RESTAURANTPROPERTY_BASE}${brochure[1]}`
        : null,
    },
    listing.hints,
  );
}

export async function fetchAndExtractRestaurantProperty(
  listing: IntelListing,
  init?: { signal?: AbortSignal },
): Promise<DisposalInsert> {
  return mapRestaurantPropertyToDisposal(await fetchHtml(listing.url, init), listing);
}
