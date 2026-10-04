import type { Metadata } from "next";
import Link from "next/link";

import { BrandLockup } from "@/components/brand-lockup";

export const metadata: Metadata = {
  title: "Cookies and analytics",
  description: "What GetBrian CRM measures with Google Analytics, only if you say yes, and the cookies that sets.",
};

const LINK =
  "text-brand-navy underline underline-offset-2 hover:text-brand-navy-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy-bright focus-visible:ring-offset-2";

const SECTIONS: { heading: string; body: React.ReactNode }[] = [
  {
    heading: "Who runs this site",
    body: (
      <p>
        CRM by GetBrian is a GetBrian product (
        <a href="https://getbrian.xyz" className={LINK}>
          getbrian.xyz
        </a>
        ). Questions about this notice or your data:{" "}
        <a href="mailto:crm@getbrian.xyz" className={LINK}>
          crm@getbrian.xyz
        </a>
        .
      </p>
    ),
  },
  {
    heading: "What we measure, and only if you say yes",
    body: (
      <p>
        If you press Accept in the cookie banner, we use Google Analytics 4 to count visits to crm.getbrian.xyz: which
        pages are viewed, roughly where from (country level), device and browser type, and how you arrived (the site
        that referred you, reduced to its address). We use it to see which pages are useful. Nothing is sent to Google
        before you accept. Pages measured: the home page and the public requirement form (the form and its thank-you
        page). Everything else on the site, including the signed-in CRM and the sign-in pages, is never measured.
      </p>
    ),
  },
  {
    heading: "What we switch off",
    body: (
      <p>
        Advertising features, ad personalisation and Google signals are off. The address of each page is sent without
        its query string (except campaign tags that start with utm_) and without any fragment. Referrers from this same
        site are not sent.
      </p>
    ),
  },
  {
    heading: "Cookies",
    body: (
      <p>
        Accepting sets these on this site only (not shared with other GetBrian sites): <code>_ga</code> and{" "}
        <code>_ga_&lt;container id&gt;</code> (tell visits apart; Google Analytics keeps them up to 2 years). Your choice
        itself is stored in your browser&rsquo;s local storage under <code>gb_consent</code> (&ldquo;granted&rdquo; or
        &ldquo;denied&rdquo;), not in a cookie, and never leaves your device. Declining sets no analytics cookies.
      </p>
    ),
  },
  {
    heading: "Changing your mind",
    body: (
      <p>
        Use &ldquo;Cookie settings&rdquo; (in the footer of the home page, or the button at the bottom left of the
        requirement form) at any time. Choosing Decline switches the tag off and deletes the analytics cookies
        immediately.
      </p>
    ),
  },
  {
    heading: "Google",
    body: (
      <p>
        Google acts as our processor for analytics; data may be processed outside the UK/EEA under Google&rsquo;s
        safeguards. Data retention in Google Analytics is set to 14 months. See Google&rsquo;s own policy at{" "}
        <a href="https://policies.google.com/privacy" className={LINK} target="_blank" rel="noopener">
          policies.google.com/privacy
        </a>
        .
      </p>
    ),
  },
  {
    heading: "Other data",
    body: (
      <p>
        The public requirement form is the CDG Leisure property requirement form. It collects what you type into it
        (company name, your name, email, phone, the property you are looking for, and any notes) and stores it in the
        CRM, where the CDG Leisure agent who owns the form reviews it. That agent and the GetBrian administrator who
        runs this system are notified in the CRM and by email. To limit spam, the form also uses your IP address,
        held temporarily by our rate-limiting service (Upstash) to count recent submissions: at most 3 in 10 minutes.
        It is not stored with your requirement. Signing in to the CRM uses an email address and password, and sets a
        session cookie so you stay signed in. Contact us at{" "}
        <a href="mailto:crm@getbrian.xyz" className={LINK}>
          crm@getbrian.xyz
        </a>{" "}
        about any other data.
      </p>
    ),
  },
];

export default function CookiesPage() {
  return (
    <div className="brand-surface flex min-h-screen flex-col font-sans">
      <header className="border-b border-brand-rule">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            aria-label="GetBrian CRM — home"
            className="inline-flex min-h-11 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy-bright focus-visible:ring-offset-2"
          >
            <BrandLockup />
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-brand-navy-soft transition-colors duration-200 hover:bg-brand-panel hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy-bright"
          >
            Back to home
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12 sm:py-16">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-brand-ink">Cookies and analytics</h1>
        <p className="mt-2 text-sm text-brand-ink-subtle">Last updated: 4 October 2026.</p>
        <div className="mt-8 space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.heading}>
              <h2 className="font-heading text-lg font-semibold text-brand-ink">{s.heading}</h2>
              <div className="mt-2 text-base leading-relaxed text-brand-ink-muted [&_code]:rounded [&_code]:bg-brand-panel [&_code]:px-1 [&_code]:text-sm">
                {s.body}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
