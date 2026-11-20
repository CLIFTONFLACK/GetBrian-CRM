// Didit — the paid identity-verification (KYC) provider. This module is the
// whole HTTP surface: everything above it (actions, report pipeline, UI) works
// in the normalised shapes at the bottom of this file and never sees Didit JSON.
//
// What it adds, and what it does not. A Didit KYC session verifies a PERSON:
// document OCR, liveness, face match, and on an AML-enabled workflow a
// watchlist screen of that person's name. It says nothing about a company —
// company facts stay with the free official sources (Companies House + OFSI +
// VAT), which remain the source of truth for a KYC report. So a Didit check is
// started against a contact (a named director, signatory or tenant), and its
// result is evidence about that individual.
//
// Sessions are billed per run (a few pence to ~$0.65 depending on the
// workflow), which is why nothing here is ever called implicitly: only
// startIdentityCheck — an explicit button — creates one.
//
// API shape (docs.didit.me, v3):
//   GET  /v3/workflows/                    → the account's workflows
//   POST /v3/session/                      → create a session
//   GET  /v3/session/{id}/decision/        → the current decision
// All authenticated with an `x-api-key` header. The check type (KYC vs KYB)
// comes from the workflow, not from the request body.

import { DIDIT_API_URL } from "../config";
import type { SanctionsMatch } from "../types";

/** A workflow as listed on the Admin page's picker. */
export type DiditWorkflow = {
  id: string;
  label: string;
  /** "kyc", "kyb", "biometric_authentication", … */
  type: string;
  /** "published" | "draft" — a draft workflow cannot start a session. */
  status: string;
  /** Per-session price in USD, as quoted by the account. */
  price: number | null;
  features: string | null;
};

/** Didit's session lifecycle, stored verbatim (see the migration's note). */
export type DiditStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "AWAITING_USER"
  | "IN_REVIEW"
  | "APPROVED"
  | "DECLINED"
  | "EXPIRED"
  | "ABANDONED"
  | "KYC_EXPIRED"
  | (string & {});

export type DiditSession = {
  sessionId: string;
  url: string | null;
  status: DiditStatus;
};

/** The parts of an identity decision the CRM actually renders. */
export type DiditKycSummary = {
  status: DiditStatus;
  /** What the document said, when one was read. */
  document: {
    fullName: string | null;
    documentType: string | null;
    documentNumber: string | null;
    dateOfBirth: string | null;
    nationality: string | null;
    issuingCountry: string | null;
    expiryDate: string | null;
    status: string | null;
  } | null;
  /** 0..1, or null when the workflow has no liveness step. */
  livenessScore: number | null;
  /** 0..1 similarity between the selfie and the document portrait. */
  faceMatchScore: number | null;
  /** Watchlist hits for this person, in the report's own match shape. */
  aml: SanctionsMatch[];
  /** Didit's own warnings (blurred document, expired ID, …). */
  warnings: string[];
  /** Didit's reason code on a declined / in-review session. */
  reason: string | null;
};

class DiditError extends Error {
  /** True when no reply came back, so the request may or may not have taken
   *  effect at Didit. For a session create, that means it may be billed. */
  outcomeUnknown = false;
}

/** Longest wait for one Didit request, body included. */
const DIDIT_TIMEOUT_MS = 15_000;

/** True when a Didit call failed without a reply (see DiditError). */
export function isDiditOutcomeUnknown(err: unknown): boolean {
  return err instanceof DiditError && err.outcomeUnknown;
}

/** One authenticated request. Errors carry Didit's own message where it sends
 *  one — a wrong key returns a JSON body, not just a status. */
async function call<T>(
  apiKey: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${DIDIT_API_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "x-api-key": apiKey,
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      // The timeout also covers reading the body.
      signal: AbortSignal.timeout(DIDIT_TIMEOUT_MS),
    });
    text = await res.text();
  } catch (err) {
    // A timeout or a dropped connection. Didit can have done the work before
    // the reply was lost, so the caller must not say that nothing happened.
    const e = new DiditError(
      `No reply from Didit (${(err as Error).name === "TimeoutError" ? "timed out" : "network error"}).`,
    );
    e.outcomeUnknown = true;
    throw e;
  }
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body (an HTML error page from a proxy, say) — fall through to
    // the status-code message below rather than throwing a parse error.
  }

  if (!res.ok) {
    const detail =
      (parsed as { detail?: string } | null)?.detail ??
      (parsed as { message?: string } | null)?.message ??
      (parsed as { error?: string } | null)?.error ??
      null;
    if (res.status === 401 || res.status === 403) {
      throw new DiditError(detail ?? "Didit rejected the API key (401/403).");
    }
    throw new DiditError(detail ?? `Didit request failed (HTTP ${res.status}).`);
  }
  return parsed as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflows — free, and the only call the Admin page makes. Doubles as the
// "is this key valid?" test: a bad key fails here before anything is saved.
// ─────────────────────────────────────────────────────────────────────────────

type RawWorkflow = {
  uuid?: string;
  workflow_id?: string;
  workflow_label?: string;
  workflow_type?: string;
  status?: string;
  total_price?: number;
  features?: string;
};

export async function listWorkflows(apiKey: string): Promise<DiditWorkflow[]> {
  const body = await call<{ results?: RawWorkflow[] }>(apiKey, "/v3/workflows/");
  return (body?.results ?? []).map((w) => ({
    id: w.workflow_id ?? w.uuid ?? "",
    label: w.workflow_label ?? "Untitled workflow",
    type: w.workflow_type ?? "unknown",
    status: w.status ?? "unknown",
    price: typeof w.total_price === "number" ? w.total_price : null,
    features: w.features ?? null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────────────────────

export type CreateSessionInput = {
  workflowId: string;
  /** Our own identifier for the subject, echoed back on decisions/webhooks. */
  vendorData: string;
  /** Where Didit returns the person after the hosted flow. */
  callbackUrl?: string | null;
  /** Contact details, so Didit can deliver the link itself where configured. */
  email?: string | null;
};

/**
 * Creates an identity-verification session. THIS IS THE BILLED CALL — one
 * session is one charge on the agency's Didit account, so it has exactly one
 * caller (startIdentityCheck) and that caller is behind an explicit button.
 *
 * Note what is deliberately NOT sent: the contact's name and date of birth.
 * The point of the check is to learn who the person is from their document;
 * pre-filling the answer from CRM data would let a typo pass for evidence. The
 * comparison between "what we had" and "what the document says" is made
 * afterwards, in the UI, where a mismatch is visible.
 */
export async function createIdentitySession(
  apiKey: string,
  input: CreateSessionInput,
): Promise<DiditSession> {
  const body = await call<{ session_id?: string; url?: string; status?: string }>(
    apiKey,
    "/v3/session/",
    {
      method: "POST",
      body: {
        workflow_id: input.workflowId,
        vendor_data: input.vendorData,
        // Didit's field is `callback`. An unknown key such as `callback_url` is
        // ignored without an error, and the workflow's default page is used.
        ...(input.callbackUrl ? { callback: input.callbackUrl } : {}),
        ...(input.email ? { contact_details: { email: input.email } } : {}),
      },
    },
  );

  if (!body?.session_id) {
    throw new DiditError("Didit did not return a session id.");
  }
  return {
    sessionId: body.session_id,
    url: body.url ?? null,
    status: (body.status as DiditStatus) ?? "NOT_STARTED",
  };
}

/** Fetches the current decision. Free, and safe to call repeatedly — this is
 *  what the "Refresh" button and the report pipeline's read path both use. */
export async function getDecision(
  apiKey: string,
  sessionId: string,
): Promise<{ status: DiditStatus; raw: unknown }> {
  const raw = await call<{ status?: string }>(
    apiKey,
    `/v3/session/${encodeURIComponent(sessionId)}/decision/`,
  );
  // Every real decision has a status. A 200 with no status (an HTML page from a
  // proxy, an empty body) must not be saved as NOT_STARTED over a real result.
  if (typeof raw?.status !== "string" || !raw.status.trim()) {
    throw new DiditError("Didit returned a decision with no status.");
  }
  return { status: raw.status as DiditStatus, raw };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping — raw decision → DiditKycSummary
//
// Written defensively on purpose. Which blocks are present depends on the
// workflow's enabled features (a workflow without AML has no aml_screenings, a
// document-only one has no face_matches), and Didit's own docs show the same
// data both as a singular object (`id_verification`, from the standalone
// endpoints) and as an array (`id_verifications[]`, from a session decision).
// Both are accepted, every array defaults to empty, and every field is
// optional-chained — so an unfamiliar shape degrades to "fewer fields shown"
// rather than throwing mid-report.
// ─────────────────────────────────────────────────────────────────────────────

type RawIdVerification = {
  status?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  document_type?: string;
  document_number?: string;
  date_of_birth?: string;
  nationality?: string;
  issuing_state?: string;
  issuing_country?: string;
  expiration_date?: string;
  expiry_date?: string;
  warnings?: (string | { risk?: string; short_description?: string })[];
};

type RawScored = { status?: string; score?: number; similarity?: number };

/** One watchlist hit. Written as a single shape covering both places Didit
 *  reports them — the session decision's `aml_screenings[]` and the standalone
 *  endpoint's `aml` — so the mapper below iterates one type, not a union. */
type RawAmlHit = {
  /** The matched entity's name in a session decision (docs.didit.me, AML
   *  screening report, per-hit fields). */
  caption?: string;
  matched_name?: string;
  name?: string;
  match_score?: number;
  score?: number;
  watchlist?: string;
  source?: string;
  sources?: string[];
};

type RawAmlScreening = {
  screened_data?: { full_name?: string; name?: string; company_name?: string };
  total_hits?: number;
  hits?: RawAmlHit[];
};

type RawDecision = {
  status?: string;
  decision_reason_code?: string;
  reason?: string;
  id_verifications?: RawIdVerification[];
  id_verification?: RawIdVerification;
  liveness_checks?: RawScored[];
  liveness?: RawScored;
  face_matches?: RawScored[];
  face_match?: RawScored;
  aml_screenings?: RawAmlScreening[];
  aml?: { total_hits?: number; hits?: RawAmlHit[] };
  warnings?: (string | { risk?: string; short_description?: string })[];
};

/** Didit reports confidence as 0..100 in some feeds and 0..1 in others; every
 *  score the CRM stores is 0..1, so normalise once, here. */
function unitScore(value: number | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  const scaled = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, scaled));
}

/** A trimmed string, or "" for anything that is not a string. */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function warningText(w: string | { risk?: string; short_description?: string }): string {
  if (typeof w === "string") return w;
  return w.short_description ?? w.risk ?? "";
}

function fullName(id: RawIdVerification): string | null {
  if (id.full_name?.trim()) return id.full_name.trim();
  const joined = [id.first_name, id.last_name].filter(Boolean).join(" ").trim();
  return joined || null;
}

/**
 * Normalises a raw decision payload. Pure — no network — so a stored raw
 * decision can be re-mapped later without paying for the check again.
 */
export function mapDecision(raw: unknown): DiditKycSummary {
  const d = (raw ?? {}) as RawDecision;

  const idv = Array.isArray(d.id_verifications)
    ? (d.id_verifications[0] ?? null)
    : (d.id_verification ?? null);
  const liveness = Array.isArray(d.liveness_checks)
    ? (d.liveness_checks[0] ?? null)
    : (d.liveness ?? null);
  const faceMatch = Array.isArray(d.face_matches)
    ? (d.face_matches[0] ?? null)
    : (d.face_match ?? null);

  const aml: SanctionsMatch[] = [];
  const screenings: RawAmlScreening[] = Array.isArray(d.aml_screenings)
    ? d.aml_screenings
    : d.aml
      ? [{ hits: d.aml.hits }]
      : [];
  for (const screen of screenings) {
    const query =
      screen.screened_data?.full_name ??
      screen.screened_data?.name ??
      screen.screened_data?.company_name ??
      (idv ? (fullName(idv) ?? "(unnamed)") : "(unnamed)");
    for (const hit of screen.hits ?? []) {
      aml.push({
        query,
        // `||`, not `??`: an empty name must fall through, not show a blank.
        // text() also turns a non-string from the payload into "", not a throw.
        matchedName:
          text(hit.caption) || text(hit.matched_name) || text(hit.name) || "(unnamed match)",
        listName: hit.watchlist ?? hit.source ?? hit.sources?.[0] ?? "Didit AML",
        score: unitScore(hit.match_score ?? hit.score) ?? 0,
      });
    }
  }

  const warnings = [...(d.warnings ?? []), ...(idv?.warnings ?? [])]
    .map(warningText)
    .filter((w) => w.length > 0);

  return {
    status: (d.status as DiditStatus) ?? "NOT_STARTED",
    document: idv
      ? {
          fullName: fullName(idv),
          documentType: idv.document_type ?? null,
          documentNumber: idv.document_number ?? null,
          dateOfBirth: idv.date_of_birth ?? null,
          nationality: idv.nationality ?? null,
          issuingCountry: idv.issuing_country ?? idv.issuing_state ?? null,
          expiryDate: idv.expiry_date ?? idv.expiration_date ?? null,
          status: idv.status ?? null,
        }
      : null,
    livenessScore: unitScore(liveness?.score),
    faceMatchScore: unitScore(faceMatch?.score ?? faceMatch?.similarity),
    aml,
    warnings,
    reason: d.decision_reason_code ?? d.reason ?? null,
  };
}

/** True once a session has reached a state where its decision is final. */
export function isTerminal(status: DiditStatus): boolean {
  return ["APPROVED", "DECLINED", "EXPIRED", "ABANDONED", "KYC_EXPIRED"].includes(
    status,
  );
}

/** Didit's status in one canonical spelling ("In Review" → "IN_REVIEW"), so the
 *  phase rules below do not depend on the casing a payload happens to use. */
export function normaliseStatus(status: string | null | undefined): DiditStatus {
  const s = (status ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return s || "NOT_STARTED";
}

/**
 * Where a check stands, for the two decisions that depend on it:
 *  - "open":    still running or held for review. Starting another one would
 *               bill again for the same person, and it has no result to report.
 *  - "decided": APPROVED or DECLINED. A result exists; a re-check hides it.
 *  - "lapsed":  expired or abandoned. No result, and nothing left to wait for.
 * An unknown status counts as "open": that is the direction that never bills
 * twice and never presents an undecided check as a result.
 */
export type DiditPhase = "open" | "decided" | "lapsed";

export function checkPhase(status: string | null | undefined): DiditPhase {
  const s = normaliseStatus(status);
  if (s === "APPROVED" || s === "DECLINED") return "decided";
  if (s === "EXPIRED" || s === "ABANDONED" || s === "KYC_EXPIRED") return "lapsed";
  return "open";
}

/** True when a check has nothing to put in a report yet: it is open and not
 *  with a human reviewer. IN_REVIEW is shown, because "held for manual review"
 *  is itself a finding. */
export function isAwaitingDecision(status: string | null | undefined): boolean {
  return checkPhase(status) === "open" && normaliseStatus(status) !== "IN_REVIEW";
}

/** True when an agency member with this role can start a paid Didit check.
 *  Admins and managers only, decided by Clifton on 2026-11-20. The server
 *  action and the KYC page both use this, so the button and the gate agree. */
export function canStartIdentityCheck(role: string | null | undefined): boolean {
  return role === "admin" || role === "manager";
}
