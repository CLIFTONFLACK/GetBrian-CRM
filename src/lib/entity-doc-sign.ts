import { createHmac, timingSafeEqual } from "crypto";

import { getEntityDocumentById, type EntityDocumentRow } from "@/lib/db/queries/entity-documents";

/**
 * Authorization and signing for company and contact documents. Same scheme as
 * src/lib/requirement-docs.ts, for the same reason: Vercel Blob has no signed
 * URL primitive, so access control is rebuilt in the app.
 *
 *   - signEntityDocUrl runs on the server, agency-scoped, when a panel renders
 *     its list. That is the real authorization check. Its output is a bearer
 *     URL valid for one hour.
 *   - /api/entity-docs/[id] checks signature and expiry on every hit and only
 *     then redirects to the Blob URL.
 *   - authorizeEntityDocument is a second path for a request with no valid
 *     token: a live, agency-scoped check for a signed-in user.
 *
 * The HMAC input starts with "ent:", so a token made for a requirement or
 * listing document never validates here, and the other way round.
 */

const TTL_MS = 3600 * 1000;

function secret(): string {
  const s = process.env.DOC_SIGNING_SECRET ?? "";
  if (!s) throw new Error("DOC_SIGNING_SECRET is not set.");
  return s;
}

function sign(docId: string, exp: number): string {
  return createHmac("sha256", secret()).update(`ent:${docId}.${exp}`).digest("hex");
}

/** Pure signature check. Every failure (missing, malformed, wrong length,
 *  tampered, expired) is `false`; it never throws on bad input. */
export function verifyEntityDocToken(docId: string, exp: number, token: string): boolean {
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

/** Confirms the document belongs to `agencyId`, then signs a one-hour URL. Null
 *  when it is not in this agency. */
export async function signEntityDocUrl(
  agencyId: string,
  docId: string,
): Promise<string | null> {
  const doc = await getEntityDocumentById(agencyId, docId);
  if (!doc) return null;
  const exp = Date.now() + TTL_MS;
  return `/api/entity-docs/${docId}?exp=${exp}&sig=${sign(docId, exp)}`;
}

export async function authorizeEntityDocument(
  agencyId: string,
  docId: string,
): Promise<EntityDocumentRow | null> {
  return getEntityDocumentById(agencyId, docId);
}
