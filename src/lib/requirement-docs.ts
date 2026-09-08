import { createHmac, timingSafeEqual } from "crypto";

import {
  getRequirementDocumentById,
  type RequirementDocumentRow,
} from "@/lib/db/queries/requirements";

/**
 * Authorization + signing for requirement documents (landlord packs).
 *
 * The same scheme as src/lib/disposal-docs.ts, for the same reason: Vercel Blob
 * has no private/signed-URL primitive (only `access: 'public'`, protected
 * solely by an unguessable path suffix, with no expiry or revocation), so the
 * access control is reimplemented in the app layer.
 *
 *   - `signRequirementDocUrl` runs server-side and agency-scoped when a page
 *     renders a document list. That is the real authorization check. Its output
 *     is a bearer URL valid for 1 hour, usable from a plain `<a href>` with no
 *     live session required to click it.
 *   - `/api/requirement-docs/[id]/route.ts` validates signature + expiry on
 *     every hit and 302s to the real Blob URL only if it checks out.
 *   - `authorizeRequirementDocument` is a second, independent authorization
 *     path used by that route as a fallback for a request arriving with no
 *     (valid) token — e.g. someone opening the bare URL while signed in.
 *
 * Kept as a separate module from disposal-docs.ts rather than generalised: the
 * two sign different id spaces, and a shared signer would have to be told which
 * kind it was signing. A token minted for one kind must never validate for the
 * other, and separate HMAC inputs make that structural rather than a rule
 * someone has to remember.
 */

const TTL_MS = 3600 * 1000; // matches the disposal-docs scheme

function secret(): string {
  const s = process.env.DOC_SIGNING_SECRET ?? "";
  if (!s) throw new Error("DOC_SIGNING_SECRET is not set.");
  return s;
}

/** Note the "req:" prefix — it namespaces this signature away from
 *  disposal-docs', so a token for one document kind can never validate for a
 *  same-numbered id of the other. */
function sign(docId: string, exp: number): string {
  return createHmac("sha256", secret()).update(`req:${docId}.${exp}`).digest("hex");
}

/**
 * Pure signature check — no DB, no session. Treats every failure mode (missing
 * token, malformed hex, wrong length, tampered signature, expired `exp`)
 * identically as `false`; never throws on bad input, so callers don't need a
 * try/catch around it.
 */
export function verifyRequirementDocToken(
  docId: string,
  exp: number,
  token: string,
): boolean {
  if (!token || !Number.isFinite(exp) || exp < Date.now()) return false;
  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(sign(docId, exp), "hex");
    actual = Buffer.from(token, "hex");
  } catch {
    return false;
  }
  if (expected.length === 0 || expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Authorization boundary (page-render time): confirms `docId` belongs to
 * `agencyId` via the agency-scoped DAO lookup, then signs a 1hr bearer URL to
 * the proxy route. Returns null when the document isn't in this agency — the
 * caller then simply omits the link.
 */
export async function signRequirementDocUrl(
  agencyId: string,
  docId: string,
): Promise<string | null> {
  const doc = await getRequirementDocumentById(agencyId, docId);
  if (!doc) return null;
  const exp = Date.now() + TTL_MS;
  const sig = sign(docId, exp);
  return `/api/requirement-docs/${docId}?exp=${exp}&sig=${sig}`;
}

/**
 * Authorization boundary (route fallback): a live, agency-scoped check with no
 * token involved — the same DAO lookup as `signRequirementDocUrl`, exported
 * separately so it can be exercised directly by a verification script without
 * importing the route handler.
 */
export async function authorizeRequirementDocument(
  agencyId: string,
  docId: string,
): Promise<RequirementDocumentRow | null> {
  return getRequirementDocumentById(agencyId, docId);
}
