/**
 * Hay Hill Property Services (hayhillpropertyservices.com) → `disposals`
 * extractor — leisure and F&B lease sales, mostly central London.
 *
 * WordPress on the RealHomes theme, which is a gift: the detail page publishes
 * a status, a price line, a geocoded full address, a fancybox gallery and a
 * features taxonomy, all in stable `rh_*` classes.
 *
 *  - List pages `/property/` then `/property/page/N/` → `/property/<slug>/`.
 *  - Detail page — `h1.rh_page__title`, `p.rh_page__property_address` (the
 *    geocoder's full address, so it carries the postcode), a
 *    `.rh_page__property_price` block holding `p.status` and `p.price`,
 *    `.rh_property__meta.prop_area` for the floor area, a `property-city`
 *    breadcrumb, the RealHomes map JSON (`"lat":"…","lng":"…"`), and an agent
 *    card whose address is entity-obfuscated.
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
  deriveDisposalType,
  deriveFitOut,
  extractPhone,
  extractPostcode,
  fetchHtml,
  htmlToLine,
  htmlToText,
  isLondonPostcode,
  normaliseStatus,
  normaliseTown,
  parseSizeSqft,
  rentPeriodFor,
  ScrapeError,
  splitAddressTitle,
  stripNoise,
  unique,
} from "./scrape-utils.ts";

export const HAYHILL_SOURCE = "hayhill";
export const HAYHILL_BASE = "https://hayhillpropertyservices.com";
export const HAYHILL_LIST_URL = `${HAYHILL_BASE}/property/`;

const MAX_PAGES = 20;

// ─────────────────────────────────────────────────────────────────────────────
// List pages.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every `/property/<slug>/` on the page.
 *
 * Matched bare rather than inside `href="…"`: the theme repeats each unit's
 * permalink across `data-property-url`, `data-property-permalink` and the
 * compare/favourite widgets, and half the cards were being missed by anchoring
 * on the attribute. Taxonomies live under `/property-city/`, `/property-type/`
 * and `/property-feature/`, so the only non-units here are the paginator and
 * the RSS endpoint.
 */
export function extractHayHillListingUrls(html: string): string[] {
  return unique(
    [
      ...html.matchAll(
        /https:\/\/hayhillpropertyservices\.com\/property\/([a-z0-9-]+)\//gi,
      ),
    ]
      .filter((m) => !/^(page|feed)$/i.test(m[1]))
      .map((m) => m[0]),
  );
}

export async function fetchHayHillListings(init?: {
  signal?: AbortSignal;
  maxPages?: number;
}): Promise<IntelListing[]> {
  const all = new Set<string>();
  const maxPages = init?.maxPages ?? MAX_PAGES;
  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? HAYHILL_LIST_URL : `${HAYHILL_LIST_URL}page/${page}/`;
    let html: string;
    try {
      html = await fetchHtml(url, init);
    } catch (err) {
      if (page === 1) throw err;
      break;
    }
    const before = all.size;
    for (const u of extractHayHillListingUrls(html)) all.add(u);
    if (all.size === before) break;
  }
  if (all.size === 0) {
    throw new ScrapeError("No Hay Hill listings found — the page structure may have changed.");
  }
  return [...all].map((url) => ({ url }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail page → DisposalInsert.
// ─────────────────────────────────────────────────────────────────────────────

export function mapHayHillToDisposal(html: string, listing: IntelListing): DisposalInsert {
  const page = stripNoise(html);
  const titleMatch = page.match(/<h1[^>]*class="rh_page__title"[^>]*>([\s\S]*?)<\/h1>/i);
  if (!titleMatch) {
    throw new ScrapeError(`No property title found at ${listing.url}`);
  }
  const title = htmlToLine(titleMatch[1]);

  const addressMatch = page.match(
    /<p[^>]*class="rh_page__property_address"[^>]*>([\s\S]*?)<\/p>/i,
  );
  const fullAddress = addressMatch ? htmlToLine(addressMatch[1]) : null;
  const postcodeFromAddress = extractPostcode(fullAddress);

  const statusMatch = page.match(
    /<div[^>]*class="rh_page__property_price"[^>]*>[\s\S]*?<p class="status">([\s\S]*?)<\/p>/i,
  );
  const priceMatch = page.match(
    /<div[^>]*class="rh_page__property_price"[^>]*>[\s\S]*?<p class="price">([\s\S]*?)<\/p>/i,
  );
  const priceText = priceMatch ? htmlToLine(priceMatch[1]) : null;

  const descMatch = page.match(
    /id="property-content-section-content"[\s\S]*?<div class="rh_content">([\s\S]*?)<\/div>/i,
  );
  const description = descMatch ? htmlToText(descMatch[1]) || null : null;

  const keyFeatures = [
    ...page.matchAll(/<li class="rh_property__feature"[^>]*>([\s\S]*?)<\/li>/gi),
  ]
    .map((m) => htmlToLine(m[1]))
    .filter(Boolean);

  const areaMatch = page.match(
    /class="rh_property__meta prop_area"[\s\S]*?<span class="figure">([\s\S]*?)<\/span>[\s\S]*?<span class="label">([\s\S]*?)<\/span>/i,
  );
  const sizeText = areaMatch ? `${htmlToLine(areaMatch[1])} ${htmlToLine(areaMatch[2])}` : null;

  const images = unique(
    [...page.matchAll(/<a[^>]+href="([^"]+)"[^>]*data-fancybox="gallery"/gi)].map((m) => m[1]),
  )
    .filter((u) => /\.(jpe?g|png|webp)$/i.test(u))
    .map((url) => ({ url, alt: null }));

  // RealHomes prints the map payload as JSON in the page bootstrap.
  const lat = html.match(/"lat"\s*:\s*"([-\d.]+)"/i);
  const lng = html.match(/"lng"\s*:\s*"([-\d.]+)"/i);

  const agentBlock = page.match(
    /class="widget rh_property_agent[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
  );
  const agentHtml = agentBlock ? agentBlock[1] : "";
  const agentName = agentHtml
    .match(/class="rh_property_agent__title"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1];
  const agentEmail = htmlToLine(agentHtml.match(/href="(mailto:[^"]+)"/i)?.[1] ?? "")
    .replace(/^mailto:/i, "")
    .split("?")[0];
  const agentPhoto = agentHtml.match(/class="agent-image"[\s\S]*?<img[^>]+src="([^"]+)"/i);

  // Town: the geocoded address beats both the headline (usually just a street,
  // "9 Great Russell Street, Bloomsbury") and the city taxonomy, which the
  // agent fills in by hand and gets wrong — a Chelmsford restaurant is filed
  // under London/East London. Nominatim writes "…, Town, County, Country,
  // POSTCODE, United Kingdom", so after dropping the country/postcode tail the
  // town is the part before the county.
  const addressParts = (fullAddress ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(
      (p) =>
        p &&
        !/^(united kingdom|england|scotland|wales|northern ireland)$/i.test(p) &&
        !(postcodeFromAddress && p.includes(postcodeFromAddress)),
    );
  const cityFromAddress =
    addressParts.length >= 2
      ? addressParts[addressParts.length - 2]
      : (addressParts[addressParts.length - 1] ?? null);
  const cityCrumb = [
    ...page.matchAll(/property-city\/[a-z0-9-]+\/"[^>]*>([\s\S]*?)<\/a>/gi),
  ].map((m) => htmlToLine(m[1]));

  const fromTitle = splitAddressTitle(title);
  const searchable = [title, description, keyFeatures.join("\n"), priceText]
    .filter(Boolean)
    .join("\n");
  const typeCrumb = page.match(/property-type\/[a-z0-9-]+\/"[^>]*>([\s\S]*?)<\/a>/i);

  const rentish = priceText != null && /per\s+annum|pax|p\.?a\.?\b|rent|passing/i.test(priceText);
  const pricePa = parseMoney(priceText);
  const disposalType = deriveDisposalType(keyFeatures.join(" "), searchable);
  const forSale = disposalType === "freehold" || (!rentish && /for sale/i.test(searchable));
  const covers = parseCovers(searchable);

  return applyHints(
    {
      source: HAYHILL_SOURCE,
      source_ref: listing.url.replace(/\/+$/, "").split("/").pop() ?? listing.url,
      source_url: listing.url,
      status: normaliseStatus(statusMatch ? htmlToLine(statusMatch[1]) : null),
      source_updated_at: null,

      title,
      summary: description ? description.split("\n")[0] : null,
      address_line: fullAddress ?? fromTitle.addressLine,
      area: null,
      city: isLondonPostcode(postcodeFromAddress)
        ? "London"
        : normaliseTown(cityFromAddress ?? cityCrumb[0] ?? fromTitle.city),
      postcode: postcodeFromAddress ?? fromTitle.postcode,
      lat: lat ? Number(lat[1]) : null,
      lng: lng ? Number(lng[1]) : null,

      property_type: typeCrumb ? htmlToLine(typeCrumb[1]) : null,
      use_class: parseUseClass(searchable),
      disposal_type: disposalType,
      to_let: !forSale,
      for_sale: forSale,

      rent_pa: rentish ? pricePa : null,
      rent_raw: rentish ? priceText : null,
      rent_period: rentish ? rentPeriodFor(priceText, pricePa) : null,
      premium: keyFeatures.some((f) => /nil premium/i.test(f)) ? 0 : null,
      premium_raw: null,
      guide_price: forSale ? pricePa : null,
      price_qualifier: parsePriceQualifier(priceText),
      vat_applicable: null,
      rateable_value: null,
      business_rates: null,
      service_charge: null,
      estate_charge: null,
      parking_charge: null,

      tenure_raw: null,
      ...parseLease(searchable),
      next_rent_review: null,

      size_sqft: parseSizeSqft(sizeText),
      size_sqm: null,
      covers_internal: covers.internal,
      covers_external: covers.external,
      floors: [],

      licensing_notes: keyFeatures.filter((f) => /licen/i.test(f)).join(", ") || null,
      fit_out_state: deriveFitOut(keyFeatures.join(" "), searchable),
      epc_rating: null,

      description,
      location_description: null,
      key_features: keyFeatures,
      sections: [],

      agent_name: agentName ? htmlToLine(agentName).replace(/^Agent\s+/i, "") : null,
      agent_email: agentEmail || null,
      agent_phone: extractPhone(htmlToText(agentHtml)),
      agent_photo: agentPhoto ? agentPhoto[1] : null,

      images,
      brochure_url: null,
    },
    listing.hints,
  );
}

export async function fetchAndExtractHayHill(
  listing: IntelListing,
  init?: { signal?: AbortSignal },
): Promise<DisposalInsert> {
  return mapHayHillToDisposal(await fetchHtml(listing.url, init), listing);
}
