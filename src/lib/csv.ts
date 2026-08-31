// Dependency-free CSV helpers for the admin bulk importer (#8). Multi-value
// cells (tags, towns) use ";" inside the cell so they don't clash with the
// "," column delimiter.

export type ImportEntity = "companies" | "contacts" | "requirements" | "listings";

/** Parse CSV text into rows of string cells (handles quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      pushField();
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Serialise headers + rows to CSV text (used for downloadable templates). */
export function toCsv(headers: string[], rows: string[][]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

/**
 * Use-class cells accept ordinary words, not slugs — "Bar;Nightclub", "Hot food
 * takeaway", even "Bar / Restaurant" in one cell. The importer runs them through
 * the same parser the forms use, so nobody has to know that Nightclub is stored
 * as `sui_generis_nightclub`.
 */
const USE_CLASS_HINT =
  "Pub, Bar, Nightclub, Hot food takeaway, Café, Gym, Leisure, Restaurant, Other";

/** Column headers, one example row, and a note on the fiddly columns. */
export const IMPORT_TEMPLATES: Record<
  ImportEntity,
  { label: string; headers: string[]; example: string[]; hint: string }
> = {
  companies: {
    label: "Companies",
    // county is derived from postcode/town when left blank. Rows whose name
    // already exists (case-insensitively) are skipped on import.
    headers: [
      "name",
      "type",
      "sector_tags",
      "website",
      "phone",
      "address_line",
      "city",
      "postcode",
      "county",
      "notes",
    ],
    example: [
      "Riverside Taverns Ltd",
      "operator",
      "Pub;Bar",
      "https://example.co.uk",
      "+44 20 7123 4567",
      "12 Riverside Walk",
      "London",
      "SE1 9PP",
      "",
      "Key operator",
    ],
    hint: `sector_tags: ${USE_CLASS_HINT}. Anything else is kept as a free tag. county is derived from postcode/town when blank.`,
  },
  contacts: {
    label: "Contacts",
    // company_name links (or creates) the contact's company; county is derived
    // from postcode/town when left blank. Rows whose email already exists
    // (case-insensitively) are skipped on import.
    headers: [
      "first_name",
      "last_name",
      "email",
      "phone",
      "role",
      "company_name",
      "address_line",
      "city",
      "postcode",
      "county",
      "marketing_opt_in",
      "notes",
    ],
    example: [
      "James",
      "Hartley",
      "james@example.co.uk",
      "+44 7700 900000",
      "acquisitions",
      "Riverside Taverns Ltd",
      "12 Riverside Walk",
      "London",
      "SE1 9PP",
      "",
      "true",
      "Met at expo",
    ],
    hint: "company_name links (or creates) the contact's company. role must match a slug from Admin → Edit contact roles, else it falls back to Other.",
  },
  requirements: {
    label: "Requirements",
    // contact_email is REQUIRED — must match an existing contact (every requirement
    // must have a contact). Import contacts first, then reference them by email.
    headers: [
      "title",
      "contact_email",
      "status",
      "target_london_zones",
      "target_neighbourhoods",
      "target_towns",
      "target_counties",
      "target_regions",
      "target_postcode_districts",
      "use_classes",
      "tenure_prefs",
      "min_sqft",
      "max_sqft",
      "min_covers",
      "max_covers",
      "max_rent",
      "max_premium",
      "max_guide_price",
      "notes",
    ],
    example: [
      "Wet-led bar, Central London",
      "james@example.co.uk",
      "active",
      "Zone 1;Zone 2",
      "Soho;Shoreditch",
      "London",
      "Surrey;Kent",
      "Greater London",
      "W1;W2",
      "Bar;Pub",
      "leasehold",
      "1200",
      "3000",
      "40",
      "120",
      "110000",
      "50000",
      "",
      "Needs late licence",
    ],
    hint: `contact_email is required and must match an existing contact — import Contacts first. use_classes: ${USE_CLASS_HINT}. tenure_prefs: freehold, leasehold. target_london_zones: Zone 1 … Zone 9.`,
  },
  listings: {
    label: "Listings",
    // contact_email is REQUIRED — must match an existing contact (every listing
    // must have a contact). Company is optional and not set via CSV.
    //
    // `use_classes` replaced the old free-text `use_class` column: the importer
    // derives both stored fields from it, exactly as the listing form does.
    headers: [
      "title",
      "contact_email",
      "listing_type",
      "status",
      "disposal_type",
      "address_line",
      "area",
      "city",
      "county",
      "postcode",
      "use_classes",
      "size_sqft",
      "covers_internal",
      "rent_pa",
      "premium",
      "guide_price",
      "description",
    ],
    example: [
      "Corner bar, Soho",
      "james@example.co.uk",
      "cdg",
      "Available",
      "new_lease",
      "42 Dean Street",
      "Soho",
      "London",
      "Greater London",
      "W1D 4SB",
      "Bar;Nightclub",
      "1850",
      "90",
      "95000",
      "120000",
      "",
      "Prime corner unit",
    ],
    hint: `contact_email is required and must match an existing contact — import Contacts first. use_classes: ${USE_CLASS_HINT} (the planning class is derived from it). listing_type: cdg or intel. disposal_type: freehold, new_lease, lease_assignment, sublease.`,
  },
};

// ---------------------------------------------------------------------------
// Reading spreadsheets nobody produced from our template
//
// Real uploads are exports from another CRM or portal: Windows-1252 bytes, a
// title banner above the header row, "First Name" where we want `first_name`,
// and commas where we want ";". Everything below exists so those files either
// import correctly or say precisely what is wrong with them — the one thing
// they must never do is import half a row in silence.
// ---------------------------------------------------------------------------

/**
 * Decode an uploaded file's bytes to text.
 *
 * `Blob.text()` decodes UTF-8 unconditionally, so a Windows-1252 export turns
 * every curly apostrophe (0x92) and pound sign (0xA3) into U+FFFD — "Lyon’s"
 * lands in the database as "Lyon<?>s" and stays wrong. Decode strictly first,
 * and only fall back to Windows-1252 once the bytes have proved they aren't
 * UTF-8.
 */
export function decodeCsvBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("windows-1252").decode(bytes);
    } catch {
      // No windows-1252 decoder (a Node build without full ICU): fall back to
      // lossy UTF-8 rather than failing the upload outright.
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

/**
 * Header cells match on letters and digits only, so "First Name", "first_name"
 * and "FIRST NAME" are one column. Space-versus-underscore was the single
 * biggest cause of "nothing imported" on real exports.
 */
export const normaliseHeader = (cell: string) =>
  cell.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Header names other systems use for our columns, already normalised.
 *
 * Only unambiguous synonyms belong here. A column we would have to guess at —
 * a lone "Size" that could be either end of a range, or an "Area" holding
 * "Within 3 miles of Rupert Street" — is reported as unrecognised instead,
 * because a wrong mapping is worse than a visible gap.
 */
const COMMON_ALIASES: Record<string, string> = {
  emailaddress: "email",
  telephone: "phone",
  tel: "phone",
  phonenumber: "phone",
  mobile: "phone",
  mobilenumber: "phone",
  mobilephone: "phone",
  address1: "address_line",
  addressline1: "address_line",
  address: "address_line",
  street: "address_line",
  town: "city",
  posttown: "city",
  postalcode: "postcode",
  zip: "postcode",
  comments: "notes",
  note: "notes",
};

/** Per-entity synonyms; these win over COMMON_ALIASES. */
const ENTITY_ALIASES: Record<ImportEntity, Record<string, string>> = {
  companies: {
    company: "name",
    companyname: "name",
    accountname: "name",
    companytype: "type",
    domain: "website",
    url: "website",
    web: "website",
    sector: "sector_tags",
    sectors: "sector_tags",
    tags: "sector_tags",
  },
  contacts: {
    forename: "first_name",
    givenname: "first_name",
    surname: "last_name",
    familyname: "last_name",
    companyname: "company_name",
    account: "company_name",
    jobtitle: "role",
    position: "role",
    marketing: "marketing_opt_in",
    optin: "marketing_opt_in",
    marketinglatestnews: "marketing_opt_in",
    marketingpropertyalerts: "marketing_opt_in",
  },
  requirements: {
    tenant: "title",
    tenantname: "title",
    requirement: "title",
    name: "title",
    tenantemail: "contact_email",
    email: "contact_email",
    contact: "contact_email",
    propertytype: "use_classes",
    useclass: "use_classes",
    usetype: "use_classes",
    sizefrom: "min_sqft",
    minsize: "min_sqft",
    sizeto: "max_sqft",
    maxsize: "max_sqft",
    rent: "max_rent",
    rentpa: "max_rent",
    premium: "max_premium",
    tenure: "tenure_prefs",
    zones: "target_london_zones",
    londonzones: "target_london_zones",
    towns: "target_towns",
    counties: "target_counties",
    regions: "target_regions",
    neighbourhoods: "target_neighbourhoods",
    postcodedistricts: "target_postcode_districts",
  },
  listings: {
    property: "title",
    propertyname: "title",
    propertytype: "use_classes",
    // Read as a fallback by the importer when `use_classes` is absent, so it
    // must resolve even though it isn't a template column.
    useclass: "use_class",
    email: "contact_email",
    sizesqft: "size_sqft",
    size: "size_sqft",
    rent: "rent_pa",
    rentpa: "rent_pa",
    price: "guide_price",
    guideprice: "guide_price",
    tenure: "disposal_type",
    type: "listing_type",
  },
};

/** Normalised template header → canonical column, per entity. */
const CANONICAL_BY_KEY = new Map<ImportEntity, Map<string, string>>(
  (Object.keys(IMPORT_TEMPLATES) as ImportEntity[]).map((entity) => [
    entity,
    new Map(IMPORT_TEMPLATES[entity].headers.map((h) => [normaliseHeader(h), h])),
  ]),
);

/** Resolve one header cell to a canonical column name, or null if unplaceable. */
function resolveHeader(entity: ImportEntity, cell: string): string | null {
  const key = normaliseHeader(cell);
  if (!key) return null;
  return (
    CANONICAL_BY_KEY.get(entity)?.get(key) ??
    ENTITY_ALIASES[entity][key] ??
    COMMON_ALIASES[key] ??
    null
  );
}

export type HeaderMap = {
  /** Canonical column → every source column index feeding it, in file order. */
  columns: Map<string, number[]>;
  /** Source headers we could not place, verbatim, for the warning message. */
  unrecognised: string[];
  /** Index into `rows` of the row the headers were read from. */
  headerRow: number;
};

/**
 * Locate the header row and map its cells onto template columns.
 *
 * Exports often lead with a title banner ("Requirements" alone on line 1), so
 * row 0 is not reliably the header. Score the first few rows by how many
 * distinct template columns each resolves and take the best; a data row scores
 * 0, and ties go to the earliest row.
 *
 * Several source columns may feed one field — "Phone Number" and "Mobile
 * Number" both map to `phone` — so each column keeps a list of indices and the
 * importer reads the first non-empty one.
 */
export function mapHeaders(entity: ImportEntity, rows: string[][]): HeaderMap {
  const limit = Math.min(rows.length, 5);
  let headerRow = 0;
  let best = -1;
  for (let i = 0; i < limit; i++) {
    const score = new Set(
      rows[i].map((c) => resolveHeader(entity, c)).filter(Boolean),
    ).size;
    if (score > best) {
      best = score;
      headerRow = i;
    }
  }
  const columns = new Map<string, number[]>();
  const unrecognised: string[] = [];
  (rows[headerRow] ?? []).forEach((cell, i) => {
    const canonical = resolveHeader(entity, cell);
    if (!canonical) {
      if (cell.trim()) unrecognised.push(cell.trim());
      return;
    }
    const at = columns.get(canonical);
    if (at) at.push(i);
    else columns.set(canonical, [i]);
  });
  return { columns, unrecognised, headerRow };
}

/**
 * Split a multi-value cell. Our template uses ";", but every other system
 * exports "Bar, Pub, Restaurant", so a cell containing no ";" falls back to
 * ",". A cell that does use ";" is taken at its word — which is how a value
 * that legitimately contains a comma ("Peek House, 20 Eastcheap") survives.
 */
export function splitList(cell: string): string[] {
  const sep = cell.includes(";") ? ";" : ",";
  return cell.split(sep).map((s) => s.trim()).filter(Boolean);
}

/** The columns a row cannot be built without, per entity. */
export const REQUIRED_COLUMNS: Record<ImportEntity, string[]> = {
  companies: ["name"],
  contacts: ["first_name"],
  requirements: ["title", "contact_email"],
  listings: ["title", "contact_email"],
};
