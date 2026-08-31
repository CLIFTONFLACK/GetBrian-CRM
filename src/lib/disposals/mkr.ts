/**
 * MKR Property (mkrproperty.co.uk) → `disposals` extractor.
 *
 * The whole book is one page — `/properties` — laid out as a grid of columns,
 * with **no detail pages at all**. Each column carries an image, a
 * `.property-title` headline ("SOHO, LONDON, W1F - FITTED RESTAURANT LEASE FOR
 * SALE"), a `.property-text` block of `LABEL: value` lines (RENT / LEASE /
 * SIZE / F&F / LICENSE) and, usually, a link to the PDF particulars.
 *
 * That makes this a `kind: "list"` source in the registry: one fetch yields
 * every row, and there is nothing further to enumerate.
 *
 * With no per-property id or URL, `source_ref` is a slug of the headline. A
 * headline edit therefore reads as a new listing and marks the old one
 * Withdrawn — the honest behaviour when the site gives us nothing stabler.
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
  deriveFitOut,
  extractPostcode,
  fetchHtml,
  htmlToLine,
  htmlToText,
  normaliseTown,
  parseSizeSqft,
  rentPeriodFor,
  resolveDisposalType,
  ScrapeError,
  splitAddressTitle,
  splitStatusPrefix,
  stripNoise,
  sumSizeSqft,
  unique,
} from "./scrape-utils.ts";

export const MKR_SOURCE = "mkr";
export const MKR_BASE = "https://www.mkrproperty.co.uk";
export const MKR_LIST_URL = `${MKR_BASE}/properties`;

/** The theme's "no photo yet" artwork — not a picture of the property. */
const PLACEHOLDER_IMAGE = /mkr-fallback/i;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** `RENT: £55,000 pax` lines from the .property-text block. */
function parseLabelledLines(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Za-z&/ ]{2,20}?)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key && value && !out.has(key)) out.set(key, value);
  }
  return out;
}

export function extractMkrDisposals(html: string, sourceUrl = MKR_LIST_URL): DisposalInsert[] {
  const page = stripNoise(html);
  const rows: DisposalInsert[] = [];
  const seen = new Set<string>();

  // One column per property; splitting on the column id keeps each card's
  // image, headline, detail lines and brochure link together.
  const columns = page.split(/<div id="column_[^"]*"/i).slice(1);

  for (const column of columns) {
    const titleMatch = column.match(
      /class="[^"]*property-title[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
    );
    if (!titleMatch) continue;
    // MKR writes state into the headline ("SOLD - BREWER STREET, SOHO, …"),
    // so strip it before the location/descriptor split below.
    const { title, status } = splitStatusPrefix(htmlToLine(titleMatch[1]));
    if (!title) continue;

    const textMatch = column.match(
      /class="[^"]*property-text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
    );
    const bodyText = textMatch ? htmlToText(textMatch[1]) : "";
    const fields = parseLabelledLines(bodyText);
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const v = fields.get(k);
        if (v) return v;
      }
      return null;
    };

    const images = unique(
      [...column.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => m[1]),
    )
      .filter((u) => !PLACEHOLDER_IMAGE.test(u))
      .map((url) => ({ url, alt: null }));

    const brochure = column.match(/<a[^>]+href="([^"]+\.pdf)"/i);

    // "SOHO, LONDON, W1F - FITTED RESTAURANT LEASE FOR SALE": the location is
    // everything before the dash, the rest is the marketing descriptor.
    const [locationPart, ...descriptorParts] = title.split(/\s+[-–—]\s+/);
    const descriptor = descriptorParts.join(" - ");
    const { addressLine, city, postcode } = splitAddressTitle(locationPart ?? title);

    const rentText = get("rent");
    const sizeText = get("size");
    const leaseText = get("lease", "tenure", "term");
    const premiumText = get("premium");
    const priceText = get("price", "guide price");
    const searchable = [title, bodyText].filter(Boolean).join("\n");

    const rentPa = parseMoney(rentText);
    const forSale = /freehold/i.test(searchable) && rentText == null;
    const covers = parseCovers(searchable);
    // A floor breakdown is summed; a range keeps its upper bound.
    const isRange = /\bto\b|\d\s*[-–—]\s*\d/i.test(sizeText ?? "");
    const sizeSqft = isRange ? parseSizeSqft(sizeText) : sumSizeSqft(sizeText) ?? parseSizeSqft(sizeText);

    const ref = slugify(title);
    if (seen.has(ref)) continue;
    seen.add(ref);

    rows.push({
      source: MKR_SOURCE,
      source_ref: ref,
      // There is no per-property page — every row points back at the book.
      source_url: sourceUrl,
      status,
      source_updated_at: null,

      title,
      summary: descriptor || null,
      address_line: addressLine,
      area: null,
      city: normaliseTown(city),
      postcode: postcode ?? extractPostcode(searchable, { fullOnly: true }),
      lat: null,
      lng: null,

      property_type: null,
      use_class: parseUseClass(searchable),
      disposal_type: resolveDisposalType(forSale ? "for-sale" : "to-let", descriptor, leaseText, searchable),
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
      rateable_value: parseMoney(get("rateable value", "rv")),
      business_rates: parseMoney(get("rates", "business rates")),
      service_charge: parseMoney(get("service charge")),
      estate_charge: null,
      parking_charge: null,

      tenure_raw: leaseText,
      ...parseLease(leaseText),
      next_rent_review: null,

      size_sqft: sizeSqft,
      size_sqm: null,
      covers_internal: covers.internal,
      covers_external: covers.external,
      floors: [],

      licensing_notes: get("license", "licence", "licensing"),
      fit_out_state: deriveFitOut(get("f&f", "fixtures"), searchable),
      epc_rating: null,

      description: bodyText || null,
      location_description: null,
      key_features: [],
      sections: [...fields.entries()].map(([k, v]) => ({
        title: k.toUpperCase(),
        content: v,
      })),

      agent_name: null,
      agent_email: null,
      agent_phone: null,
      agent_photo: null,

      images,
      brochure_url: brochure ? brochure[1] : null,
    });
  }

  return rows;
}

/** Fetches the single properties page and returns every row on it. */
export async function fetchMkrDisposals(init?: {
  signal?: AbortSignal;
}): Promise<DisposalInsert[]> {
  const rows = extractMkrDisposals(await fetchHtml(MKR_LIST_URL, init));
  if (rows.length === 0) {
    throw new ScrapeError("No MKR listings found — the page structure may have changed.");
  }
  return rows;
}
