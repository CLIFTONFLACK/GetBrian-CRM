// Centralised KYC env access. Mirrors lib/maps/config.ts: every KYC feature reads
// from here and fails soft when a key is absent, so the app keeps working (with a
// "not configured" notice) before the keys are set in Vercel.

/** Companies House Public Data API — free key from
 *  https://developer.company-information.service.gov.uk. Server-only (HTTP Basic
 *  auth, key as username). NEVER prefix with NEXT_PUBLIC. */
export const COMPANIES_HOUSE_API_KEY = process.env.COMPANIES_HOUSE_API_KEY ?? "";

/** Base URL for the Companies House Public Data API. */
export const COMPANIES_HOUSE_API_BASE =
  "https://api.company-information.service.gov.uk";

/** OFSI / UK Sanctions List — free consolidated list (no key). */
export const OFSI_CONSOLIDATED_LIST_URL =
  process.env.OFSI_CONSOLIDATED_LIST_URL ??
  "https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.csv";

/** Didit — OPTIONAL, paid KYB/AML provider (~$2.20/session). The free official
 *  sources (Companies House + OFSI + VAT) remain the source of truth.
 *
 *  These env vars are only a FALLBACK for a single-tenant deployment. The
 *  primary place the credentials live is agency_settings (entered on the Admin
 *  page), because a session is billed to whichever Didit account started it —
 *  see src/lib/kyc/didit-config.ts, which prefers the agency row. Server-only. */
export const DIDIT_API_KEY = process.env.DIDIT_API_KEY ?? "";
/** Workflow of workflow_type "kyb". Didit takes the check type from the
 *  workflow, so a key without one cannot start a business check. */
export const DIDIT_WORKFLOW_ID = process.env.DIDIT_WORKFLOW_ID ?? "";
/** The one agency that may use the env credentials above. The app is
 *  multi-tenant and public sign-up makes new agencies, so without this every
 *  agency with no key of its own would bill the operator's Didit account.
 *  Unset means no agency uses the env fallback. */
export const DIDIT_ENV_AGENCY_ID = process.env.DIDIT_ENV_AGENCY_ID?.trim() ?? "";
export const DIDIT_API_URL =
  process.env.DIDIT_API_URL ?? "https://verification.didit.me";

/** True once the Companies House key is present (gates the core report). */
export const isKycConfigured = Boolean(COMPANIES_HOUSE_API_KEY);

/** True once BOTH Didit env vars are present. This only covers the env-var
 *  fallback — an agency that entered its credentials in Admin is configured
 *  regardless of what this says, which is why nothing gates a KYB run on it
 *  (getAgencyDidit() is the real check). */
export const isDiditEnvConfigured = Boolean(DIDIT_API_KEY && DIDIT_WORKFLOW_ID);

// The UI already shows a "not configured" notice, but that's easy to miss during
// deployment — surface it once in server logs too.
if (!COMPANIES_HOUSE_API_KEY) {
  console.warn(
    "[config] COMPANIES_HOUSE_API_KEY is not set — KYC reports will run without company/officer/PSC data.",
  );
}
