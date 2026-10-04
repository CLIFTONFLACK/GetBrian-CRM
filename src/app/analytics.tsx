"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import {
  GA_MEASUREMENT_ID,
  REOPEN_EVENT,
  clearGaCookies,
  gaInitScript,
  isExcludedPath,
  isTrackedHost,
  readConsent,
  showsBanner,
  subscribeConsent,
  writeConsent,
  type Consent,
} from "@/lib/consent";

const subscribeHost = () => () => {};
const hostSnapshot = () => window.location.hostname;
const noHost = () => "";

/**
 * Consent banner plus the GA4 tag. Renders nothing on the server, so the static
 * HTML is identical for everyone and nothing flashes before hydration.
 */
export function Analytics() {
  const hostname = useSyncExternalStore(subscribeHost, hostSnapshot, noHost);
  const consent = useSyncExternalStore<Consent | null>(subscribeConsent, readConsent, () => null);
  const pathname = usePathname();
  const [reopened, setReopened] = useState(false);

  // The footer's "Cookie settings" link asks for the banner again.
  useEffect(() => {
    const open = () => setReopened(true);
    window.addEventListener(REOPEN_EVENT, open);
    return () => window.removeEventListener(REOPEN_EVENT, open);
  }, []);

  // Withdrawing consent switches the tag off and removes its cookies.
  useEffect(() => {
    if (!hostname) return;
    // The flag is Google's documented off switch; flipping it back on a re-grant matters
    // because the init script does not run twice in one page view.
    const w = window as unknown as Record<string, unknown> & { gtag?: (...args: unknown[]) => void };
    w[`ga-disable-${GA_MEASUREMENT_ID}`] = consent !== "granted" || isExcludedPath(pathname);
    if (consent === "denied") {
      w.gtag?.("consent", "update", { analytics_storage: "denied" }); // match Google's own consent state
      clearGaCookies(document, hostname);
    } else if (consent === "granted") {
      w.gtag?.("consent", "update", { analytics_storage: "granted" });
    }
  }, [consent, hostname, pathname]);

  if (!hostname || isExcludedPath(pathname)) return null;
  const load = consent === "granted" && isTrackedHost(hostname);
  const showBanner = showsBanner(hostname) && (consent === null || reopened);
  // The home page carries the footer link; every other route gets this small one so
  // withdrawing consent is as easy as giving it wherever the visitor happens to be.
  const showChip = showsBanner(hostname) && !showBanner && consent !== null && pathname !== "/";

  const choose = (value: Consent) => {
    writeConsent(value);
    setReopened(false);
  };

  return (
    <>
      {load && (
        <>
          <Script id="ga-init" strategy="afterInteractive">
            {gaInitScript()}
          </Script>
          <Script
            id="ga-src"
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
            strategy="afterInteractive"
          />
        </>
      )}
      {showChip && (
        <button
          type="button"
          onClick={() => setReopened(true)}
          className="fixed bottom-3 left-3 z-40 min-h-11 cursor-pointer rounded-full border border-brand-rule-strong bg-white px-4 text-xs font-medium text-brand-ink-muted shadow-sm transition-colors duration-200 hover:text-brand-navy"
        >
          Cookie settings
        </button>
      )}
      {showBanner && (
        <section
          aria-label="Cookie choice"
          className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-md rounded-2xl border border-brand-rule-strong bg-white p-5 shadow-xl pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:left-auto sm:right-4 sm:mx-0"
        >
          <h2 className="font-heading text-base font-semibold text-brand-ink">Cookies</h2>
          <p className="mt-1 text-sm text-brand-ink-muted">
            Can we use Google Analytics cookies to see which pages people visit? No ads and nothing is sold. We
            remember your choice on this device, and you can change it any time with the &ldquo;Cookie settings&rdquo; link.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => choose("denied")}
              className="min-h-12 cursor-pointer rounded-full border border-brand-navy px-4 text-base font-semibold text-brand-navy transition-colors duration-200 hover:bg-brand-panel"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => choose("granted")}
              className="min-h-12 cursor-pointer rounded-full bg-brand-gold px-4 text-base font-semibold text-brand-ink transition-colors duration-200 hover:bg-brand-gold-hover"
            >
              Accept
            </button>
          </div>
        </section>
      )}
    </>
  );
}

/** Footer link that reopens the banner so a choice can be changed. */
export function CookieSettingsButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(REOPEN_EVENT))}
      className="inline-block -my-3.5 -mx-1 cursor-pointer px-1 py-3.5 underline-offset-2 hover:text-brand-navy hover:underline"
    >
      Cookie settings
    </button>
  );
}
