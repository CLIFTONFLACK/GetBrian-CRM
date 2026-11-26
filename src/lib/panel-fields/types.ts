// The allow-list behind inline editing in the record panels. A client sends a
// field KEY and a raw string; this module decides which column that key means
// and whether the value is acceptable. A key that is not listed is rejected, so
// a client can never write a column the registry does not name.
//
// Pure module: no database and no framework imports, so it can be tested.

export type FieldKind =
  | "text"
  | "textarea"
  | "url"
  | "email"
  | "phone"
  | "select"
  | "multi"
  | "tags"
  | "number"
  | "date"
  | "boolean";

export type FieldValue = string | string[] | number | boolean | null;
export type ParseResult = { ok: true; value: FieldValue } | { ok: false; error: string };

export type FieldDef = {
  /** What the client sends. */
  key: string;
  /** The database column it writes. */
  column: string;
  label: string;
  kind: FieldKind;
  /** An empty value is an error. */
  required?: boolean;
  maxLength?: number;
  /** For "select" and "multi": the values that are allowed. */
  options?: readonly string[];
  /** For "number": the smallest and largest value (default 0 and 1,000,000,000), and whole numbers only. */
  min?: number;
  max?: number;
  integer?: boolean;
  /** Extra check after the default parse of the kind. */
  validate?: (value: FieldValue) => string | null;
};

export type Registry = Record<string, FieldDef>;

const DEFAULT_MAX = 500;
const TEXTAREA_MAX = 10_000;
const NUMBER_MAX = 1_000_000_000;

/** Add "https://" when the value has no scheme, then accept http(s) only. */
export function normaliseUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return withScheme;
  } catch {
    return null;
  }
}

function finish(def: FieldDef, value: FieldValue): ParseResult {
  const problem = def.validate?.(value) ?? null;
  return problem ? { ok: false, error: problem } : { ok: true, value };
}

/** True for a real calendar date written as yyyy-mm-dd. */
export function isIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** Parse one raw value for one field. Never throws. A "multi" field takes a list. */
export function parseField(def: FieldDef, raw: unknown): ParseResult {
  if (def.kind === "multi") {
    const list = Array.isArray(raw)
      ? raw.map((v) => String(v))
      : typeof raw === "string" && raw.trim()
        ? raw.split(",")
        : [];
    const values = [...new Set(list.map((v) => v.trim()).filter(Boolean))];
    if (def.options && values.some((v) => !def.options!.includes(v))) {
      return { ok: false, error: `${def.label} has a value that is not in the list.` };
    }
    if (def.required && values.length === 0) return { ok: false, error: `${def.label} is required.` };
    return finish(def, values);
  }

  const text = typeof raw === "string" ? raw : raw == null ? "" : String(raw);

  if (def.kind === "boolean") {
    const t = text.trim().toLowerCase();
    if (!["true", "false", "on", "off", "1", "0", ""].includes(t)) {
      return { ok: false, error: `${def.label} must be yes or no.` };
    }
    return finish(def, ["true", "on", "1"].includes(t));
  }

  const trimmed = text.trim();
  if (!trimmed) {
    if (def.required) return { ok: false, error: `${def.label} is required.` };
    return finish(def, def.kind === "tags" ? [] : null);
  }

  const max = def.maxLength ?? (def.kind === "textarea" ? TEXTAREA_MAX : DEFAULT_MAX);
  if (trimmed.length > max) {
    return { ok: false, error: `${def.label} is too long (most ${max} characters).` };
  }

  switch (def.kind) {
    case "url": {
      const url = normaliseUrl(trimmed);
      if (!url) {
        return { ok: false, error: `${def.label} must be a web address, for example example.co.uk.` };
      }
      return finish(def, url);
    }
    case "tags": {
      const tags = [...new Set(trimmed.split(/[;,]/).map((t) => t.trim()).filter(Boolean))];
      return finish(def, tags);
    }
    case "select": {
      if (def.options && !def.options.includes(trimmed)) {
        return { ok: false, error: `Pick one of the listed values for ${def.label}.` };
      }
      return finish(def, trimmed);
    }
    case "number": {
      // Pound signs, commas and spaces are allowed as typed: "£95,000".
      const n = Number(trimmed.replace(/[£,\s]/g, ""));
      if (!Number.isFinite(n)) return { ok: false, error: `${def.label} must be a number.` };
      const lo = def.min ?? 0;
      const hi = def.max ?? NUMBER_MAX;
      if (n < lo || n > hi) {
        return { ok: false, error: `${def.label} must be between ${lo.toLocaleString("en-GB")} and ${hi.toLocaleString("en-GB")}.` };
      }
      if (def.integer && !Number.isInteger(n)) {
        return { ok: false, error: `${def.label} must be a whole number.` };
      }
      return finish(def, n);
    }
    case "date": {
      if (!isIsoDate(trimmed)) return { ok: false, error: `${def.label} must be a date, written year-month-day.` };
      return finish(def, trimmed);
    }
    default:
      return finish(def, trimmed);
  }
}

/** Look a field up by key. Own keys only, so "constructor" and "__proto__" are not fields. */
export function fieldFor(registry: Registry, key: unknown): FieldDef | null {
  if (typeof key !== "string") return null;
  return Object.prototype.hasOwnProperty.call(registry, key) ? registry[key] : null;
}
