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
  // CR as well as LF: a lone carriage return would otherwise be read back as a row break.
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
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
    // county is derived from postcode/town when left blank. A row matching an
    // existing company — by company_number when supplied, else by name —
    // UPDATES it; blank cells leave the stored value alone.
    headers: [
      "name",
      "company_number",
      "vat_number",
      "type",
      "sector_tags",
      "website",
      "phone",
      "address_line",
      "city",
      "postcode",
      "county",
      "notes",
      "date_updated",
    ],
    example: [
      "Riverside Taverns Ltd",
      "09876543",
      "GB123456789",
      "operator",
      "Pub;Bar",
      "https://example.co.uk",
      "+44 20 7123 4567",
      "12 Riverside Walk",
      "London",
      "SE1 9PP",
      "",
      "Key operator",
      "",
    ],
    hint: `sector_tags: ${USE_CLASS_HINT}. Anything else is kept as a free tag. county is derived from postcode/town when blank. Re-uploading updates matching companies (company_number first, then name) — blank cells never clear existing data.`,
  },
  contacts: {
    label: "Contacts",
    // company_name links (or creates) the contact's company; county is derived
    // from postcode/town when left blank. A row matching an existing contact —
    // by email when supplied, else by first+last name within the same company —
    // UPDATES it; blank cells leave the stored value alone.
    headers: [
      "first_name",
      "last_name",
      "email",
      "phone",
      "mobile",
      "role",
      "company_name",
      "address_line",
      "city",
      "postcode",
      "county",
      "marketing_opt_in",
      "marketing_property_alerts",
      "notes",
      "date_updated",
    ],
    example: [
      "James",
      "Hartley",
      "james@example.co.uk",
      "+44 20 7123 0000",
      "+44 7700 900000",
      "acquisitions",
      "Riverside Taverns Ltd",
      "12 Riverside Walk",
      "London",
      "SE1 9PP",
      "",
      "true",
      "",
      "Met at expo",
      "",
    ],
    hint: "company_name links (or creates) the contact's company. role must match a slug from Admin → Edit contact roles, else it falls back to Other.",
  },
  requirements: {
    label: "Requirements",
    // A requirement must be linked to a company or a contact — supply
    // contact_email (matched against an existing contact) or company_name, or
    // both. Import contacts/companies first, then reference them here.
    //
    // external_ref is optional: give a row your own reference and re-uploading
    // the file UPDATES that requirement instead of adding a second copy.
    headers: [
      "external_ref",
      "title",
      "contact_email",
      "company_name",
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
      "date_updated",
    ],
    example: [
      "REQ-1042",
      "Wet-led bar, Central London",
      "james@example.co.uk",
      "Riverside Taverns Ltd",
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
      "",
    ],
    hint: `Supply contact_email (must match an existing contact) or company_name — at least one. Import Contacts/Companies first. use_classes: ${USE_CLASS_HINT}. tenure_prefs: freehold, leasehold. target_london_zones: Zone 1 … Zone 9. external_ref is optional: set it and a re-upload updates that row instead of duplicating it. With no external_ref column (an export from another system with no ID), an exact re-upload updates the same rows; a row that changed is matched to the stored requirement by tenant and contact when that is unambiguous, otherwise it is added as a new requirement. Size, Rent and Area text is read where it can be; the rest stays in notes.`,
  },
  listings: {
    label: "Listings",
    // contact_email is REQUIRED — must match an existing contact (every listing
    // must have a contact). Company is optional and not set via CSV.
    //
    // external_ref is optional: give a row your own reference and re-uploading
    // the file UPDATES that listing instead of adding a second copy. It is
    // stored as disposals.source_ref under source='import', which the
    // unique (agency_id, source, source_ref) index from 0004 already covers.
    //
    // `use_classes` replaced the old free-text `use_class` column: the importer
    // derives both stored fields from it, exactly as the listing form does.
    headers: [
      "external_ref",
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
      "LST-2291",
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
 * because a wrong mapping is worse than a visible gap. (Requirements now read
 * Size, Rent and Area as text and parse them in import-parse.ts, which keeps
 * whatever it cannot place in notes, so those three are no longer gaps.)
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
  comment: "notes",
  note: "notes",
  generalnotes: "notes",
  internalnotes: "notes",
};

/** "Date Updated" and its usual spellings, for the three entities that carry it. */
const DATE_UPDATED_ALIASES: Record<string, string> = {
  dateupdated: "date_updated",
  updated: "date_updated",
  lastupdated: "date_updated",
  modified: "date_updated",
  datemodified: "date_updated",
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
    companynumber: "company_number",
    companieshousenumber: "company_number",
    crn: "company_number",
    registrationnumber: "company_number",
    regno: "company_number",
    vat: "vat_number",
    vatno: "vat_number",
    vatnumber: "vat_number",
    ...DATE_UPDATED_ALIASES,
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
    marketinglatestnews: "marketing_opt_in",
    marketingpropertyalerts: "marketing_property_alerts",
    // A bare "Mobile" is the mobile column for contacts (COMMON_ALIASES sends it
    // to "phone", which is right for companies: they have no mobile field).
    mobile: "mobile",
    mobilenumber: "mobile",
    mobilephone: "mobile",
    cell: "mobile",
    ...DATE_UPDATED_ALIASES,
  },
  requirements: {
    ref: "external_ref",
    reference: "external_ref",
    externalref: "external_ref",
    externalreference: "external_ref",
    id: "external_ref",
    company: "company_name",
    companyname: "company_name",
    operator: "company_name",
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
    // Free-text columns from other systems ("1,000 to 4,000 sq ft", "Up to
    // £100,000 per annum", "Zone 1, W1, Soho"). They resolve to internal names
    // that are not template columns; the importer parses them (import-parse.ts).
    size: "size_text",
    rent: "rent_text",
    area: "area_text",
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
    ...DATE_UPDATED_ALIASES,
  },
  listings: {
    ref: "external_ref",
    reference: "external_ref",
    externalref: "external_ref",
    externalreference: "external_ref",
    id: "external_ref",
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
 * Several source columns may feed one field, so each canonical column keeps a
 * list of indices and the importer reads the first non-empty one. Companies have
 * one phone field, so "Phone Number" and "Mobile Number" both map to `phone`
 * there (the importer keeps the second number in notes). Contacts have both
 * fields: "Phone Number" maps to `phone`, and "Mobile", "Mobile Number" and
 * "Mobile Phone" map to `mobile`.
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

/**
 * The most text one upload may carry. Server actions refuse request bodies over
 * 1 MB by default (next.config.ts leaves that alone), so the importer checks
 * the same limit itself, with a message the admin can act on, instead of
 * failing with a bare framework error. Excel files are checked after they are
 * turned into text.
 */
export const MAX_IMPORT_BYTES = 1_000_000;

/** The most data rows one import may carry. */
export const MAX_IMPORT_ROWS = 20_000;

/** What kind of upload a file name is; null for anything the importer rejects. */
export function importFileKind(name: string): "csv" | "xlsx" | null {
  const ext = name.trim().toLowerCase().split(".").pop();
  if (ext === "csv" || ext === "txt") return "csv";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  return null;
}

/**
 * The columns a row cannot be built without, per entity — checked once against
 * the header row, so a missing column is reported as one clear message instead
 * of N identical per-row errors.
 *
 * Requirements no longer demand `contact_email`: a requirement needs a company
 * OR a contact (see src/lib/requirement-rules.ts), so a file may carry either
 * column. That pair can't be expressed here — this list is an AND — so the
 * "one of" check lives in the importer alongside the row-level rule, and the
 * header check only insists on the title.
 */
export const REQUIRED_COLUMNS: Record<ImportEntity, string[]> = {
  companies: ["name"],
  contacts: ["first_name"],
  requirements: ["title"],
  listings: ["title", "contact_email"],
};
