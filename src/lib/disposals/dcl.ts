/**
 * Davis Coffer Lyons (dcl.co.uk) → `disposals` extractor — the largest
 * dedicated leisure agency in the London market.
 *
 * WordPress + Visual Composer, server-rendered, and unusually aggressive about
 * HTML entities: commas, full stops and pound signs are all written as numeric
 * references (`&#44;` `&#46;` `&#163;`), so every field has to go through the
 * shared entity decoder before it means anything.
 *
 *  - List pages `/our-properties/` then `/our-properties/page/N/` — nine cards
 *    per page linking to `/property/<slug>/`. No status flag is published; the
 *    site's own disclaimer says stock under offer stays listed, so everything
 *    imports as Available and the CRM's own status takes over from there.
 *  - Detail page `/property/<slug>/` — `div.property_list > h2` is
 *    "Address, Town, POSTCODE", `.sgl_desc` is the description, then a column
 *    of `<h4>Location</h4><p>…` blocks (Location / Tenure / Planning /
 *    Licensing …), a `.advert_address` contact block and a `.pdf-link`
 *    brochure. The Google Maps embed carries the postcode as its `q=`.
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
  decodeEntities,
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
  stripNoise,
  unique,
} from "./scrape-utils.ts";

export const DCL_SOURCE = "dcl";
export const DCL_BASE = "https://www.dcl.co.uk";
export const DCL_LIST_URL = `${DCL_BASE}/our-properties/`;

/** Hard stop on the pagination walk — the book has run to ~8 pages. */
const MAX_PAGES = 30;

// ─────────────────────────────────────────────────────────────────────────────
// List pages.
// ─────────────────────────────────────────────────────────────────────────────

export function extractDclListingUrls(html: string): string[] {
  return unique(
    [...html.matchAll(/https:\/\/www\.dcl\.co\.uk\/property\/[a-z0-9-]+\//gi)].map((m) => m[0]),
  );
}

/** Walks `/our-properties/`, `/page/2/`, … until a page adds nothing new. */
export async function fetchDclListings(init?: {
  signal?: AbortSignal;
  maxPages?: number;
}): Promise<IntelListing[]> {
  const all = new Set<string>();
  const maxPages = init?.maxPages ?? MAX_PAGES;
  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? DCL_LIST_URL : `${DCL_LIST_URL}page/${page}/`;
    let html: string;
    try {
      html = await fetchHtml(url, init);
    } catch (err) {
      if (page === 1) throw err;
      break; // past the last page WordPress 404s — that's the end of the book
    }
    const before = all.size;
    for (const u of extractDclListingUrls(html)) all.add(u);
    if (all.size === before) break;
  }
  if (all.size === 0) {
    throw new ScrapeError("No Davis Coffer Lyons listings found — the page structure may have changed.");
  }
  return [...all].map((url) => ({ url }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail page → DisposalInsert.
// ─────────────────────────────────────────────────────────────────────────────

/** The `<h4>Label</h4><p>…</p>` blocks in the detail column, in page order. */
function parseLabelledBlocks(html: string): { title: string; content: string }[] {
  const out: { title: string; content: string }[] = [];
  const re = /<h4[^>]*>([\s\S]*?)<\/h4>([\s\S]*?)(?=<h4[^>]*>|$)/gi;
  for (const m of html.matchAll(re)) {
    const title = htmlToLine(m[1]).replace(/[:\s]+$/, "");
    const content = htmlToText(m[2]);
    if (title && content) out.push({ title, content });
  }
  return out;
}

export function mapDclToDisposal(html: string, listing: IntelListing): DisposalInsert {
  const page = stripNoise(html);
  const main = page.match(
    /<div class="col-md-8[^"]*property_list"[^>]*>([\s\S]*?)<div class="col-md-12 disclaimer"/i,
  );
  const body = main ? main[1] : page;

  const titleMatch = body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (!titleMatch) {
    throw new ScrapeError(`No property title found at ${listing.url}`);
  }
  const title = htmlToLine(titleMatch[1]);

  const descMatch = body.match(/<div[^>]*class="[^"]*sgl_desc[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const description = descMatch
    ? htmlToText(descMatch[1].replace(/<h3[^>]*>[\s\S]*?<\/h3>/i, ""))
    : null;

  // The labelled blocks live in the first half-width column, after the contact
  // card is excluded (it is also built from <h4>s).
  const detailColumn = body
    .replace(/<div[^>]*class="[^"]*advert_address[^"]*"[^>]*>[\s\S]*?$/i, "")
    .replace(/<div[^>]*class="[^"]*sgl_desc[^"]*"[^>]*>[\s\S]*?<\/div>/i, "");
  const sections = parseLabelledBlocks(detailColumn);
  const section = (...names: string[]) => {
    for (const n of names) {
      const hit = sections.find((s) => s.title.toLowerCase() === n);
      if (hit) return hit.content;
    }
    return null;
  };

  const tenureText = section("tenure", "lease", "terms", "tenure & terms");
  const locationText = section("location");
  const planningText = section("planning", "use", "use class");
  const licensingText = section("licensing", "licence", "premises licence");
  const rentText = section("rent", "rental");
  const priceText = section("price", "guide price", "premium");

  const searchable = [title, description, ...sections.map((s) => s.content)]
    .filter(Boolean)
    .join("\n");

  // The maps embed is the only structured location signal on the page.
  const mapQuery = page.match(/maps\/embed\/v1\/place\?q=([^&"]+)/i);
  const { addressLine, city, postcode } = splitAddressTitle(title);

  const images = unique(
    [...body.matchAll(/<div[^>]*class="header-image"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/gi)].map(
      (m) => m[1],
    ),
  ).map((url) => ({ url, alt: null }));

  const brochure = body.match(
    /<div[^>]*class="[^"]*pdf-link[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i,
  );

  const contact = body.match(
    /<div[^>]*class="[^"]*advert_address[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const contactHtml = contact ? contact[1] : "";
  const agentName = contactHtml
    .match(/<h4[^>]*><span>Contact<\/span>([\s\S]*?)<\/h4>/i)?.[1];
  const agentEmail = contactHtml.match(/mailto:\s*([^"\s]+)/i)?.[1];

  // Rent and premium are usually inside the tenure prose ("Rental offers in the
  // region of £65,000 pax will be considered"), not a dedicated field.
  const tenureMoney = tenureText?.match(
    /(?:rent(?:al)?|offers|premium)[^£\n]{0,60}(£[\d,]+(?:\.\d+)?)/i,
  );
  const rentRaw = rentText ?? (tenureMoney ? tenureMoney[0] : null);
  const rentPa = parseMoney(rentRaw?.replace(/^[^£]*/, "") ?? null);
  const forSale = /freehold|for sale/i.test(`${tenureText ?? ""} ${title}`);
  const covers = parseCovers(searchable);

  return applyHints(
    {
      source: DCL_SOURCE,
      source_ref: listing.url.replace(/\/+$/, "").split("/").pop() ?? listing.url,
      source_url: listing.url,
      // DCL publishes no per-property status; its own disclaimer notes stock
      // under offer stays on the site. Everything lands Available.
      status: "Available",
      source_updated_at: null,

      title,
      summary: description ? description.split("\n")[0] : null,
      address_line: addressLine,
      area: null,
      city,
      postcode:
        postcode ??
        extractPostcode(mapQuery ? decodeURIComponent(decodeEntities(mapQuery[1])) : null) ??
        extractPostcode(searchable, { fullOnly: true }),
      lat: null,
      lng: null,

      property_type: null,
      use_class: parseUseClass(planningText, searchable),
      disposal_type: resolveDisposalType(forSale ? "for-sale" : "to-let", tenureText, title),
      to_let: !forSale,
      for_sale: forSale,

      rent_pa: rentPa,
      rent_raw: rentRaw,
      rent_period: rentPeriodFor(rentRaw, rentPa),
      premium: null,
      premium_raw: null,
      guide_price: forSale ? parseMoney(priceText) : null,
      price_qualifier: parsePriceQualifier(rentRaw, priceText, tenureText),
      vat_applicable: null,
      rateable_value: parseMoney(section("rateable value")),
      business_rates: parseMoney(section("rates", "business rates", "rates payable")),
      service_charge: parseMoney(section("service charge")),
      estate_charge: null,
      parking_charge: null,

      tenure_raw: tenureText,
      ...parseLease(tenureText),
      next_rent_review: null,

      size_sqft: parseSizeSqft(section("accommodation", "size") ?? description),
      size_sqm: null,
      covers_internal: covers.internal,
      covers_external: covers.external,
      floors: [],

      licensing_notes: licensingText,
      fit_out_state: deriveFitOut(searchable),
      epc_rating: null,

      description,
      location_description: locationText,
      key_features: [],
      sections,

      agent_name: agentName ? htmlToLine(agentName) : null,
      agent_email: agentEmail ? decodeEntities(agentEmail).trim() : null,
      agent_phone: extractPhone(htmlToText(contactHtml)),
      agent_photo: null,

      images,
      brochure_url: brochure ? decodeEntities(brochure[1]) : null,
    },
    listing.hints,
  );
}

export async function fetchAndExtractDcl(
  listing: IntelListing,
  init?: { signal?: AbortSignal },
): Promise<DisposalInsert> {
  return mapDclToDisposal(await fetchHtml(listing.url, init), listing);
}
