// Address edits from the record panel. Pure: no database, no network. The
// action does the I/O (read the stored row, geocode, write) and calls these for
// the decisions, so the decisions can be tested.

export type AddressInput = {
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  county: string | null;
};

export type AddressParse = { ok: true; value: AddressInput } | { ok: false; error: string };

const LIMITS = { address_line: 200, city: 100, postcode: 10, county: 100 } as const;
const LABELS = { address_line: "Address", city: "Town", postcode: "Postcode", county: "County" } as const;

/** "sw1a  1aa " becomes "SW1A 1AA" style spacing: upper case, single spaces. */
export function normalisePostcode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Check the four address fields. A blank county is filled from the postcode or
 * town by `deriveCounty`, which the caller passes in (it reads reference data).
 */
export function parseAddress(
  raw: Partial<Record<keyof AddressInput, unknown>>,
  deriveCounty: (p: { postcode: string | null; city: string | null }) => string | null,
): AddressParse {
  const out: AddressInput = { address_line: null, city: null, postcode: null, county: null };
  for (const key of Object.keys(LIMITS) as (keyof AddressInput)[]) {
    const text = (typeof raw[key] === "string" ? (raw[key] as string) : "").trim();
    if (text.length > LIMITS[key]) {
      return { ok: false, error: `${LABELS[key]} is too long (most ${LIMITS[key]} characters).` };
    }
    out[key] = text || null;
  }
  if (out.postcode) {
    out.postcode = normalisePostcode(out.postcode);
    if (!/^[A-Z0-9 ]{2,10}$/.test(out.postcode)) {
      return { ok: false, error: "The postcode has characters that a postcode does not use." };
    }
  }
  if (!out.county) out.county = deriveCounty({ postcode: out.postcode, city: out.city });
  return { ok: true, value: out };
}

export type StoredGeo = {
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
};

export type GeoDecision = {
  /** Coordinates to write. */
  lat: number | null;
  lng: number | null;
  /** What to tell the user after the save, or null for nothing extra. */
  note: string | null;
};

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "") === (b ?? "");

/** True when the stored record already has a pin and the address text has not changed. */
export function pinStillValid(next: AddressInput, existing: StoredGeo | null): boolean {
  return (
    existing != null &&
    existing.lat != null &&
    existing.lng != null &&
    same(existing.address_line, next.address_line) &&
    same(existing.city, next.city) &&
    same(existing.postcode, next.postcode)
  );
}

/**
 * Decide the coordinates to store with a saved address.
 *
 * - No address text at all: clear the pin.
 * - Address text unchanged and a pin exists: keep the pin (`geocoded` is not read).
 * - Otherwise use the fresh geocode. When it failed, clear the pin rather than
 *   keep one that now points at the old address, and say so.
 */
export function decideGeo(
  next: AddressInput,
  existing: StoredGeo | null,
  geocoded: { lat: number; lng: number } | null,
): GeoDecision {
  const hasText = Boolean(next.address_line || next.city || next.postcode);
  if (!hasText) return { lat: null, lng: null, note: null };

  if (existing && pinStillValid(next, existing)) {
    return { lat: existing.lat, lng: existing.lng, note: null };
  }

  if (geocoded) return { lat: geocoded.lat, lng: geocoded.lng, note: null };
  return {
    lat: null,
    lng: null,
    note: "Saved, but the address could not be placed on the map. Check the spelling and the postcode.",
  };
}
