import { BLOB_HOST_SUFFIX } from "@/lib/blob-url";
import { isUuid } from "@/lib/uuid";

// Documents attached to a company or a contact (db/migrations/0045). Pure
// helpers for the upload path and the file name, so the rules the upload-token
// route and the add action enforce can be unit-tested.
//
// A genuine upload lands at
//   https://<store>.public.blob.vercel-storage.com/entity-docs/<type>/<uuid>/<ms>-<safe-name>
// The browser builds that path, so the token route does not trust it: it
// re-validates the whole string with isValidEntityDocPath.

export const ENTITY_DOC_TYPES = ["company", "contact"] as const;
export type EntityDocType = (typeof ENTITY_DOC_TYPES)[number];

export const ENTITY_DOC_ROOT = "entity-docs";
export const ENTITY_DOC_MAX_BYTES = 10 * 1024 * 1024;
export const ENTITY_DOC_CONTENT_TYPES = ["application/pdf"];

/** Longest safe file name we build, extension included. */
const MAX_SAFE_NAME = 100;

export function isEntityDocType(v: unknown): v is EntityDocType {
  return typeof v === "string" && (ENTITY_DOC_TYPES as readonly string[]).includes(v);
}

/**
 * Turns any browser file name into one safe path segment: no path separators,
 * no dot-dot, no control characters, only letters, digits, dot, underscore and
 * hyphen, at most 100 characters (the extension is kept), never empty and never
 * starting with a dot.
 */
export function sanitiseFileName(raw: string): string {
  // Some browsers send a full path. Keep only what follows the last separator.
  let name = String(raw ?? "");
  const cut = Math.max(name.lastIndexOf("/"), name.lastIndexOf(String.fromCharCode(92)));
  name = name.slice(cut + 1);
  // Everything outside the allowed set becomes an underscore. This also turns
  // control characters, spaces and every non-ASCII letter into underscores.
  name = name.replace(/[^A-Za-z0-9._-]/g, "_");
  // No "..", however many dots arrive in a row.
  name = name.replace(/\.{2,}/g, ".");
  // No hidden file, no leading separator characters.
  name = name.replace(/^[._-]+/, "");
  if (name.length > MAX_SAFE_NAME) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
    name = name.slice(0, MAX_SAFE_NAME - ext.length) + ext;
  }
  return name || "file";
}

/** `entity-docs/<type>/<uuid>/` — the only folder a record's uploads may use. */
export function entityDocPrefix(type: EntityDocType, id: string): string {
  return `${ENTITY_DOC_ROOT}/${type}/${id.toLowerCase()}/`;
}

/** The upload path the browser asks a token for. */
export function buildEntityDocPath(
  type: EntityDocType,
  id: string,
  fileName: string,
  nowMs: number,
): string {
  return `${entityDocPrefix(type, id)}${Math.trunc(nowMs)}-${sanitiseFileName(fileName)}`;
}

const LEAF = /^[0-9]{10,16}-[A-Za-z0-9._-]{1,100}$/;

/**
 * True only for exactly `entity-docs/<type>/<id>/<digits>-<safe name>`: the
 * record's own folder, one segment, no dot-dot, nothing else. Used by the token
 * route before it mints an upload token.
 */
export function isValidEntityDocPath(pathname: unknown, type: unknown, id: unknown): boolean {
  if (typeof pathname !== "string" || !isEntityDocType(type)) return false;
  if (typeof id !== "string" || !isUuid(id)) return false;
  const prefix = entityDocPrefix(type, id);
  if (!pathname.startsWith(prefix)) return false;
  const leaf = pathname.slice(prefix.length);
  return LEAF.test(leaf) && !leaf.includes("..");
}

/**
 * True when `url` is a Vercel Blob URL whose path is a valid upload path of this
 * record. The add action stores the URL, the download route redirects to it and
 * delete passes it to `del()`, so an arbitrary URL must never be accepted.
 */
export function isOurEntityDocUrl(url: unknown, type: unknown, id: unknown): boolean {
  if (typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(BLOB_HOST_SUFFIX)) return false;
  // Credentials in the URL, a port or a query would not come from a real upload.
  if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    return false;
  }
  return isValidEntityDocPath(parsed.pathname.slice(1), type, id);
}

/** The name shown in the list: the original file name without control
 *  characters, trimmed, at most 200 characters. Rendered as text, never as HTML. */
export function displayFileName(raw: unknown): string {
  let out = "";
  for (const ch of String(raw ?? "")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) out += ch;
  }
  return out.trim().slice(0, 200);
}
