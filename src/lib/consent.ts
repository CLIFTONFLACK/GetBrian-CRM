/**
 * Cookie consent for Google Analytics (GA4 property "GetBrian - CRM").
 *
 * Basic Consent Mode: gtag.js is not loaded at all until the visitor accepts, so
 * nothing is sent to Google before consent. The choice is kept in localStorage on
 * this device only.
 *
 * Scope: only the public marketing page and the public requirement form are measured.
 * Everything behind sign-in (the CRM itself), the sign-in pages and the API carry client
 * data and record identifiers in their addresses, so they never load the tag or show the
 * banner.
 */
export const GA_MEASUREMENT_ID = "G-DH8FGLMYQ0";
/** Where the banner links for the fuller explanation, if the site has a privacy page. */
export const PRIVACY_HREF: string | null = "/cookies";
export const CONSENT_KEY = "gb_consent";
export const CONSENT_EVENT = "gb:consent-change";
export const REOPEN_EVENT = "gb:cookie-settings";

export type Consent = "granted" | "denied";

/** The only host that reports to the GetBrian - CRM property. */
export function isTrackedHost(hostname: string): boolean {
  return hostname.toLowerCase() === "crm.getbrian.xyz";
}

/** The banner shows where it can take effect, plus localhost so it can be developed. */
export function showsBanner(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return isTrackedHost(h) || h === "localhost" || h === "127.0.0.1";
}

export function parseConsent(raw: string | null | undefined): Consent | null {
  return raw === "granted" || raw === "denied" ? raw : null;
}

// Where the choice lives when storage is blocked or throws: it then lasts for this page view.
let memoryChoice: Consent | null = null;

export function readConsent(): Consent | null {
  try {
    return parseConsent(window.localStorage.getItem(CONSENT_KEY)) ?? memoryChoice;
  } catch {
    return memoryChoice; // never consent unless the visitor chose it this page view
  }
}

export function writeConsent(value: Consent): void {
  memoryChoice = value;
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Storage blocked: memoryChoice carries the choice for this page view.
  }
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

/** Test hook: forget the in-memory choice. */
export function resetMemoryChoiceForTests(): void {
  memoryChoice = null;
}

/** The public pages that are measured: the marketing page and the requirement form. */
export function isTrackedPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/submit-requirement" || pathname.startsWith("/submit-requirement/");
}

/** Everything else (the signed-in CRM, sign-in, API) never loads the tag or shows the banner. */
export function isExcludedPath(pathname: string): boolean {
  return !isTrackedPath(pathname);
}

export function subscribeConsent(onChange: () => void): () => void {
  window.addEventListener(CONSENT_EVENT, onChange);
  window.addEventListener("storage", onChange); // another tab changed it
  return () => {
    window.removeEventListener(CONSENT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Names of the cookies gtag.js sets: _ga, _ga_<container>, _gid, _gat, _gat_*. */
export function isGaCookieName(name: string): boolean {
  return name === "_ga" || name === "_gid" || name.startsWith("_ga_") || name === "_gat" || name.startsWith("_gat_");
}

/**
 * Expire GA cookies on this host only. The tag is configured with a host-only cookie_domain,
 * so it never writes to the shared parent domain, and withdrawing here must not delete the
 * cookies another getbrian.xyz site set for its own visitors.
 */
export function clearGaCookies(doc: Document, hostname: string): void {
  for (const pair of doc.cookie.split(";")) {
    const name = pair.split("=")[0].trim();
    if (!isGaCookieName(name)) continue;
    doc.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.${hostname}`;
    doc.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${hostname}`;
    doc.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

/** The address Google is allowed to see: no query string except utm_*, no fragment. */
export function cleanAddress(href: string): string {
  const u = new URL(href);
  for (const k of Array.from(u.searchParams.keys())) {
    if (!/^utm_/i.test(k)) u.searchParams.delete(k);
  }
  u.hash = "";
  return u.toString();
}

/** The flag Google documents as the off switch for a measurement ID. */
export function disableFlag(id: string = GA_MEASUREMENT_ID): string {
  return `ga-disable-${id}`;
}

/**
 * Inline snippet run once consent is granted. Consent Mode v2 signals are set before
 * `config`: analytics storage granted, the three advertising signals denied (no ads here).
 *
 * Page views are sent by hand (send_page_view:false), so a history change in the browser can
 * never report an address the app did not choose to send: the first one is sent here, later
 * ones by the component for tracked paths only. Addresses lose their query string (except
 * utm_*) and fragment; the referrer is blank for same-site referrers and origin-only for
 * others. Cookies are host-only.
 */
export function gaInitScript(id: string = GA_MEASUREMENT_ID): string {
  return [
    "window.dataLayer = window.dataLayer || [];",
    "function gtag(){dataLayer.push(arguments);}",
    "window.gtag = gtag;",
    `window['ga-disable-${id}'] = false;`,
    "gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});",
    "gtag('js', new Date());",
    "var u = new URL(location.href);",
    "Array.from(u.searchParams.keys()).forEach(function(k){ if (!/^utm_/i.test(k)) u.searchParams.delete(k); });",
    "u.hash = '';",
    "var r = '';",
    "try { var q = new URL(document.referrer); if (q.origin !== location.origin) r = q.origin; } catch (e) {}",
    `gtag('config','${id}',{send_page_view:false,cookie_domain:location.hostname,allow_google_signals:false,allow_ad_personalization_signals:false});`,
    "gtag('event','page_view',{page_location:u.toString(),page_referrer:r});",
    "window.__gbLastPath = location.pathname;",
  ].join("\n");
}
