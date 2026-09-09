import { createHmac, timingSafeEqual } from "crypto";

import {
  getDisposalDocumentById,
  type DisposalDocumentRow,
} from "@/lib/db/queries/disposals";

/**
 * Authorization + signing for the private `disposal-docs` "bucket".
 *
 * Vercel Blob has no private/signed-URL primitive (only `access: 'public'`,
 * protected solely by an unguessable path suffix, no expiry/revocation) —
 * see AGENTS.md's storage batch note. Dropping real access control here
 * would silently regress a feature that's explicitly tenant-scoped today
 * (vendor documents/floor plans), so this module reimplements it in the app
 * layer, mirroring the exact bearer-link semantics of the Supabase call it
 * replaces (`createSignedUrls(paths, 3600)`):
 *
 *   - `signDisposalDocUrl` runs server-side, agency-scoped, when a page
 *     renders a document list (the listing detail page). That's the real
 *     authorization check — same pattern as `requireAgencyAdmin` in
 *     src/lib/actions/admin.ts. Its output is a bare bearer URL, valid for
 *     1hr, usable from a plain `<a href>` with no live session required to
 *     click it — exactly like the old signed URL.
 *   - `/api/disposal-docs/[id]/route.ts` validates the signature + expiry on
 *     every hit and 302s to the real Blob URL only if it checks out.
 *   - `authorizeDisposalDocument` is a second, independent authorization
 *     path used only as a fallback by that same route, for a request that
 *     arrives with no (valid) token — e.g. someone opens the bare
 *     `/api/disposal-docs/[id]` URL directly while signed in. Kept as a
 *     plain, HTTP-free function (rather than inlined in the route) so it —
 *     and the signature check above — can each be exercised directly by a
 *     test script without going over HTTP.
 */

const TTL_MS = 3600 * 1000; // matches the old createSignedUrls(paths, 3600)

function secret(): string {
  const s = process.env.DOC_SIGNING_SECRET ?? "";
  if (!s) throw new Error("DOC_SIGNING_SECRET is not set.");
  return s;
}

/** Note the "disp:" prefix — it namespaces this signature away from
 *  requirement-docs' ("req:"), so a token for one document kind can never
 *  validate for a same-numbered id of the other. */
function sign(docId: string, exp: number): string {
  return createHmac("sha256", secret()).update(`disp:${docId}.${exp}`).digest("hex");
}

/**
 * Pure signature check — no DB, no session. Treats every failure mode
 * (missing token, malformed hex, wrong length, tampered signature, expired
 * `exp`) identically as `false`; never throws on bad input, so callers don't
 * need a try/catch around it.
 */
export function verifyDocToken(docId: string, exp: number, token: string): boolean {
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
 * `agencyId` via the DAO's agency-scoped lookup, then signs a 1hr bearer URL
 * to the proxy route. Returns null if the document isn't found in this
 * agency — the caller (the listing detail page) just omits the link,
 * mirroring the old code's `signedByPath.get(...) ?? null`.
 */
export async function signDisposalDocUrl(
  agencyId: string,
  docId: string,
): Promise<string | null> {
  const doc = await getDisposalDocumentById(agencyId, docId);
  if (!doc) return null;
  const exp = Date.now() + TTL_MS;
  const sig = sign(docId, exp);
  return `/api/disposal-docs/${docId}?exp=${exp}&sig=${sig}`;
}

/**
 * Authorization boundary (route fallback): a live, agency-scoped check with
 * no token involved — same DAO lookup as `signDisposalDocUrl`, exported
 * separately so a verification script can prove a cross-agency `agencyId`
 * is rejected and the correct one is allowed without importing the route
 * handler itself.
 */
export async function authorizeDisposalDocument(
  agencyId: string,
  docId: string,
): Promise<DisposalDocumentRow | null> {
  return getDisposalDocumentById(agencyId, docId);
}
