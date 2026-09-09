import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { isDbConfigured } from "@/lib/db/client";
import { updateExternalSendTrackingByProviderId } from "@/lib/db/queries/deals";

/**
 * POST /api/webhooks/resend — email engagement tracking.
 *
 * Resend signs webhooks with Svix. The `svix` package is deliberately NOT a
 * dependency here, so the Svix scheme is verified by hand with node:crypto:
 * HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}`, keyed by the
 * base64 body of `RESEND_WEBHOOK_SECRET` ("whsec_…"), compared constant-time
 * against every `v1,…` signature in the `svix-signature` header.
 *
 * If the request carries no Svix headers, a plain shared-secret header
 * (`x-webhook-secret`) is accepted instead — same constant-time comparison —
 * for proxies/tests that can't sign. When RESEND_WEBHOOK_SECRET is unset,
 * verification is skipped entirely (set it in production).
 *
 * Each event is matched to its `external_sends` row by the Resend message id
 * already stored in `provider_id`. Unknown ids and unhandled event types are
 * acknowledged with 200 so Resend stops retrying.
 */

/** Tolerated clock skew for the signed timestamp (Svix's own default). */
const TIMESTAMP_TOLERANCE_S = 5 * 60;

const eq = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

function verify(request: Request, raw: string, secret: string): boolean {
  const sharedHeader = request.headers.get("x-webhook-secret");
  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    // No Svix envelope — fall back to the shared-secret header.
    return Boolean(sharedHeader) && eq(sharedHeader as string, secret);
  }

  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > TIMESTAMP_TOLERANCE_S) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${svixId}.${svixTimestamp}.${raw}`)
    .digest("base64");

  // Header form: "v1,<sig> v1,<sig>" — any match passes.
  return svixSignature
    .split(" ")
    .filter((part) => part.startsWith("v1,"))
    .some((part) => eq(part.slice(3), expected));
}

/** Event type → the column stamped with the event time. */
const STAMP: Record<string, "delivered_at" | "opened_at" | "clicked_at" | "bounced_at"> =
  {
    "email.delivered": "delivered_at",
    "email.opened": "opened_at",
    "email.clicked": "clicked_at",
    "email.bounced": "bounced_at",
  };

/**
 * Events that are about specific recipients, not the send as a whole. A
 * multi-recipient send shares one provider_id across its rows, so these are
 * narrowed to the addresses in `data.to` (which Resend populates per event —
 * a bounce carries only the address that bounced). Delivered/opened/clicked
 * stay send-wide: an accepted trade-off of the shared To: line.
 */
const PER_RECIPIENT = new Set(["email.bounced"]);

type ResendEvent = {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; created_at?: string; to?: unknown };
};

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Fail CLOSED in production: an unset secret must never mean "accept any
    // unauthenticated POST" (which would let anyone forge delivered/opened/
    // bounced events and corrupt engagement tracking). Only allow unsigned
    // requests outside production, so local testing without a secret still works.
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "RESEND_WEBHOOK_SECRET not configured." },
        { status: 503 },
      );
    }
  } else if (!verify(request, raw, secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(raw) as ResendEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const type = event.type ?? "";
  const emailId = event.data?.email_id;
  // Object.hasOwn, not a bare STAMP[type]: a bare index lookup with
  // type="constructor" (or another Object.prototype key) would return a
  // function off the prototype chain, which then flows into sql.unsafe in the
  // DAO. Only own keys map to a real column.
  const column = Object.hasOwn(STAMP, type) ? STAMP[type] : undefined;
  // Acknowledge anything we don't track (email.sent, delivery_delayed, …).
  if (!column || !emailId) return NextResponse.json({ ok: true, ignored: type });

  if (!isDbConfigured) {
    return NextResponse.json(
      { error: "STORAGE_CRM_DATABASE_URL not configured." },
      { status: 503 },
    );
  }

  const at = event.created_at ?? event.data?.created_at ?? new Date().toISOString();
  const status = type.replace(/^email\./, "");
  // `data.to` is a string[] in Resend's payload; tolerate a bare string and
  // drop anything that isn't a string. Only consulted for per-recipient events;
  // if it's absent on one, fall back to stamping the whole send (as before).
  const rawTo = event.data?.to;
  const to = (Array.isArray(rawTo) ? rawTo : rawTo != null ? [rawTo] : []).filter(
    (v): v is string => typeof v === "string",
  );
  const recipients = PER_RECIPIENT.has(type) && to.length > 0 ? to : undefined;

  // provider_id (Resend's own message id) is the sole correlation key and is
  // globally unique — no caller agencyId to scope by here (see AGENTS.md);
  // the DAO resolves the row purely from this id.
  let updated: boolean;
  try {
    updated = await updateExternalSendTrackingByProviderId(emailId, {
      status,
      column,
      at,
      recipients,
    });
  } catch (err) {
    // 500 → Resend retries.
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  if (!updated) {
    // Row may simply not be written yet — 500 so Resend retries.
    return NextResponse.json({ error: "No external_sends row for this provider id yet." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
