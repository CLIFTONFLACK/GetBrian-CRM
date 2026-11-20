import { NextResponse } from "next/server";

import { isDbConfigured } from "@/lib/db/client";
import { getAgencySettings } from "@/lib/db/queries/admin";
import { getDiditSession } from "@/lib/db/queries/kyc";
import { getAgencyDidit } from "@/lib/kyc/didit-config";
import { syncDiditDecision } from "@/lib/kyc/didit-sync";
import { diditSignatureHeaders, verifyDiditSignature } from "@/lib/kyc/didit-webhook";

/**
 * POST /api/webhooks/didit/<agency id> — Didit calls this when an identity
 * check changes status, so the KYC page updates without "Refresh".
 *
 * Public: Didit has no CRM session. Trust comes only from the signature:
 *  1. The agency id in the path picks that agency's signing secret
 *     (agency_settings.didit_webhook_secret). Each agency has its own Didit
 *     account, so each has its own webhook destination and secret.
 *  2. verifyDiditSignature checks the HMAC and the 5-minute replay window.
 *  3. The session must be a didit_sessions row OF THAT AGENCY.
 *  4. The decision in the body is NOT used. syncDiditDecision fetches it again
 *     from Didit with the agency's API key (free) and saves it — the same code
 *     as the "Refresh" button.
 *
 * Status codes follow Didit's retry rules (docs.didit.me/integration/webhooks):
 *  - 400 for a refused delivery. 401/403/404/410 would mark the destination for
 *    reconnection, so they are not used.
 *  - 200 for a delivery that needs nothing (unknown session, no session id),
 *    so Didit stops retrying.
 *  - 500 when the re-fetch fails, so Didit retries later.
 */

/** A decision payload is tens of KB. Anything far larger is not from Didit. */
const MAX_BODY_BYTES = 1_000_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const refuse = (error: string) => NextResponse.json({ error }, { status: 400 });

/**
 * Reads the body as UTF-8, or returns null once it passes `max` bytes. The
 * count runs while the stream is read, so a chunked body with no
 * Content-Length is stopped at the cap, not buffered whole before the check.
 */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agencyId: string }> },
): Promise<Response> {
  const { agencyId } = await params;
  if (!UUID.test(agencyId)) return refuse("Unknown destination.");
  if (!isDbConfigured) {
    return NextResponse.json({ error: "Database not configured." }, { status: 500 });
  }

  const raw = await readCapped(request, MAX_BODY_BYTES);
  if (raw === null) return refuse("Body too large.");

  // One message for every refusal before the signature passes, so a caller
  // cannot learn which agencies have a webhook set up.
  const settings = await getAgencySettings(agencyId);
  const secret = settings?.didit_webhook_secret?.trim() ?? "";
  if (!secret || !verifyDiditSignature(raw, diditSignatureHeaders(request.headers), secret)) {
    return refuse("Invalid signature.");
  }

  let sessionId = "";
  try {
    const body = JSON.parse(raw) as { session_id?: unknown };
    if (typeof body.session_id === "string") sessionId = body.session_id.trim();
  } catch {
    return refuse("Body is not JSON.");
  }
  if (!sessionId) return NextResponse.json({ ok: true, ignored: "no session_id" });

  const row = await getDiditSession(agencyId, sessionId);
  if (!row) return NextResponse.json({ ok: true, ignored: "unknown session" });

  const config = await getAgencyDidit(agencyId);
  if (!config) return NextResponse.json({ ok: true, ignored: "Didit not configured" });

  try {
    const { status } = await syncDiditDecision(agencyId, row, config.apiKey);
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    console.error(`[didit webhook] sync of ${sessionId} failed:`, (err as Error).message);
    return NextResponse.json({ error: "Could not fetch the decision." }, { status: 500 });
  }
}
