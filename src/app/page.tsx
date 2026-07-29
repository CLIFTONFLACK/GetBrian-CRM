import Link from "next/link";
import { ArrowUpRight, Check, Handshake } from "lucide-react";

import { BrandLockup } from "@/components/brand-lockup";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────────────────
   Brian | CRM — the public marketing page.

   This is a brand surface, not app chrome. Everything below is drawn from the
   fixed `brand-*` ramp rather than the semantic theme tokens, so a visitor
   whose OS prefers dark still gets the brand as the field guide specifies:
   ink navy, brushed gold, white. `.brand-surface` (globals.css) pins the
   ground and the colour-scheme; don't reach for `bg-card`/`text-muted-
   foreground` in here or the page will half-flip in dark mode.

   Gold is a shout, not a texture. It is used as a *fill* exactly twice — the
   hero CTA and the closing CTA — plus hairline accents. Small gold text on
   white is only ever Gold Deep (5.3:1); Brian Gold itself is 3.1:1 and is a
   fill/logotype colour only.
   ───────────────────────────────────────────────────────────────────────── */

/** Brian's other tools, for the cross-sell footer band. The legacy
    `*.cliftonai.co` hosts still answer, but cliftonai.co is being retired —
    crm.cliftonai.co is already gone — so link the getbrian.xyz names. */
const SIBLINGS = [
  {
    name: "ContentFlow",
    tag: "Content operations for WordPress",
    href: "https://flow.getbrian.xyz",
  },
  {
    name: "DiffDoc",
    tag: "Document comparison",
    href: "https://diffdoc.getbrian.xyz",
  },
  {
    name: "DealMaker",
    tag: "Deal pipeline for small business",
    href: "https://dealmaker.getbrian.xyz",
  },
];

const PROOF = [
  {
    stat: "Scored matching",
    body: "Every requirement against every listing, ranked, with the reasons written out.",
  },
  {
    stat: "Licensing-grade detail",
    body: "Use class, premises licence, covers and extraction on every record.",
  },
  {
    stat: "One workspace",
    body: "CRM, listings, matching, KYC, map and pipeline. No tab-hopping.",
  },
];

const PAINS = [
  {
    title: "The requirement in someone's inbox",
    body: "An operator told a colleague exactly what they wanted three weeks ago. It's in an email thread nobody else can see, and a rival agent has just found them the site.",
  },
  {
    title: "A CRM built for somebody else's sector",
    body: "Most agents run leisure deals through systems built for offices and sheds. Even the sector's own tools can't search on a premises licence, covers or extraction — the things that decide the deal aren't fields you can filter on.",
  },
  {
    title: "Matching that's really just browsing",
    body: "If the system can't say what an operator wants, 'matching' means scrolling a long list and trusting your memory. The right site is in there, buried under forty that were never right.",
  },
];

const SHOWCASE = [
  {
    path: "/matches",
    src: "/guide/matches.png",
    alt: "The MatchMaker screen, scoring each requirement against each listing with a match percentage, the reasons behind it, and a Create deal button on every row",
    kicker: "MatchMaker",
    title: "Only the pairings that genuinely fit",
    body: "MatchMaker scores every live requirement against every live listing on the criteria other systems can't even search — location, size, use class, tenure, rent against budget. Weak pairings never reach your screen. What's left is a ranked shortlist, each one with its reasons spelled out.",
    points: [
      "Anything under 50% is filtered out before you see it",
      "Scored on leisure criteria, not generic property fields",
      "Every match explains itself, and one click turns it into a deal",
    ],
  },
  {
    path: "/listings",
    src: "/guide/listings-detail.png",
    alt: "A listing detail page showing premises attributes, commercial terms, a location map and a Download PDF button",
    kicker: "Listings",
    title: "Every field a licensed unit actually needs",
    body: "Use class, premises licence, covers, extraction, tenure, rent, premium, guide price — the detail operators actually ask about, structured on every record. Then out the door as branded PDF particulars in one click.",
    points: [
      "Purpose-built fields for restaurants, bars and licensed units",
      "One-click branded PDF particulars, ready to send",
      "Share, print, or post it to your website from the same screen",
    ],
  },
];

/* ── Brand controls ───────────────────────────────────────────────────────── */

/** The gold shout. Ink on Brian Gold measures 5.8:1; the hover fill holds 4.7:1. */
const CTA_GOLD = cn(
  "inline-flex min-h-11 items-center justify-center rounded-md bg-brand-gold px-6 py-3",
  "font-heading text-base font-semibold text-brand-ink",
  "transition-colors duration-200 hover:bg-brand-gold-hover",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy-bright focus-visible:ring-offset-2 focus-visible:ring-offset-white",
);

/** Same shout, reversed: on navy grounds the on-white gold ramp goes muddy. */
const CTA_GOLD_ON_NAVY = cn(
  "inline-flex min-h-11 items-center justify-center rounded-md bg-brand-gold-light px-6 py-3",
  "font-heading text-base font-semibold text-brand-ink",
  "transition-colors duration-200 hover:bg-brand-gold",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-light focus-visible:ring-offset-2 focus-visible:ring-offset-brand-navy",
);

const CTA_QUIET = cn(
  "inline-flex min-h-11 items-center justify-center rounded-md border border-brand-rule-strong bg-white px-6 py-3",
  "font-heading text-base font-semibold text-brand-navy",
  "transition-colors duration-200 hover:bg-brand-panel",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy-bright focus-visible:ring-offset-2 focus-visible:ring-offset-white",
);

const NAV_LINK = cn(
  "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-brand-navy-soft",
  "transition-colors duration-200 hover:bg-brand-panel hover:text-brand-navy",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy-bright",
);

/** A product screenshot in a plain browser frame, captioned with its route. */
function ShotFrame({
  path,
  src,
  alt,
  eager = false,
}: {
  path: string;
  src: string;
  alt: string;
  /** Set on the hero shot: it's the LCP element, so it must not be lazy. */
  eager?: boolean;
}) {
  return (
    <figure className="overflow-hidden rounded-xl border border-brand-rule-strong bg-white shadow-[0_18px_50px_-24px_rgba(10,29,59,0.45)]">
      <div className="flex items-center gap-1.5 border-b border-brand-rule bg-brand-panel px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-brand-rule-strong" />
        <span className="h-2.5 w-2.5 rounded-full bg-brand-rule-strong" />
        <span className="h-2.5 w-2.5 rounded-full bg-brand-rule-strong" />
        <span className="ml-2 truncate font-mono text-[11px] text-brand-ink-subtle">
          {path}
        </span>
      </div>
      {/* Captured at 1440×900 (16:10); the fixed ratio reserves the space so
          the page doesn't jump while they load. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        decoding="async"
        className="block aspect-[16/10] w-full bg-brand-panel object-cover object-top"
      />
    </figure>
  );
}

export default function LandingPage() {
  return (
    <div className="brand-surface flex min-h-screen flex-col font-sans">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="border-b border-brand-rule">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-y-3 px-6 py-4">
          <Link
            href="/"
            aria-label="Brian CRM — home"
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy-bright focus-visible:ring-offset-2"
          >
            <BrandLockup />
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a
              href="https://getbrian.xyz"
              target="_blank"
              rel="noopener"
              className={cn(NAV_LINK, "hidden gap-1 sm:inline-flex")}
            >
              Built by Brian
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </a>
            <Link href="/login" className={NAV_LINK}>
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className={cn(CTA_GOLD, "px-4 py-2 text-sm")}
            >
              Start free
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-6xl px-6 pb-16 pt-12 sm:pb-24 sm:pt-20">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
            <div>
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand-rule-strong px-3 py-1 text-xs font-medium text-brand-navy-soft">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-gold" aria-hidden />
                UK leisure &amp; licensed property
              </p>
              <h1 className="font-heading text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-brand-navy sm:text-5xl">
                The CRM that speaks fluent licensed premises.
              </h1>
              <div className="mt-6 h-1 w-14 rounded-full bg-brand-gold" aria-hidden />
              <p className="mt-6 max-w-md text-pretty text-lg leading-relaxed text-brand-ink-muted">
                Your operators, landlords and listings in one place. MatchMaker
                reads every requirement against every listing and puts the
                pairings worth your morning at the top.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/sign-up" className={CTA_GOLD}>
                  Start free — takes a minute
                </Link>
                <Link href="/login" className={CTA_QUIET}>
                  Sign in
                </Link>
              </div>
              <p className="mt-4 text-sm text-brand-ink-subtle">
                No card. Your agency workspace is ready the moment you sign up.
              </p>
            </div>
            <ShotFrame
              eager
              path="/matches"
              src="/guide/matches.png"
              alt="The MatchMaker screen, listing scored requirement-and-listing pairings with the reasons behind each score"
            />
          </div>
        </section>

        {/* ── Proof strip ────────────────────────────────────────────────── */}
        <section className="border-y border-brand-rule bg-brand-panel">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-12 sm:grid-cols-3">
            {PROOF.map((p) => (
              <div key={p.stat}>
                <p className="font-heading text-xl font-semibold tracking-tight text-brand-navy">
                  {p.stat}
                </p>
                <p className="mt-2 leading-relaxed text-brand-ink-muted">
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── The problem ────────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <h2 className="font-heading text-balance text-3xl font-semibold tracking-tight text-brand-navy">
              Sound familiar?
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-brand-ink-muted">
              Most leisure agencies run on spreadsheets, inboxes and memory. It
              works fine — right up until it costs you a deal.
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {PAINS.map((p) => (
              <div
                key={p.title}
                className="border-t-2 border-brand-navy-bright pt-5"
              >
                <h3 className="font-heading text-lg font-semibold text-brand-navy">
                  {p.title}
                </h3>
                <p className="mt-3 leading-relaxed text-brand-ink-muted">
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── What it does ───────────────────────────────────────────────── */}
        {SHOWCASE.map((f, i) => (
          <section
            key={f.kicker}
            className={cn(
              "border-t border-brand-rule",
              i % 2 === 1 && "bg-brand-panel",
            )}
          >
            <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-6 py-20 lg:grid-cols-2 lg:gap-16">
              <div className={i % 2 === 1 ? "lg:order-2" : undefined}>
                <p className="font-heading text-sm font-semibold uppercase tracking-[0.14em] text-brand-gold-deep">
                  {f.kicker}
                </p>
                <h2 className="mt-3 font-heading text-balance text-3xl font-semibold tracking-tight text-brand-navy">
                  {f.title}
                </h2>
                <p className="mt-4 leading-relaxed text-brand-ink-muted">
                  {f.body}
                </p>
                <ul className="mt-6 space-y-3">
                  {f.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-3 text-brand-ink">
                      <Check
                        className="mt-1 h-4 w-4 shrink-0 text-brand-gold-deep"
                        aria-hidden
                      />
                      {pt}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={i % 2 === 1 ? "lg:order-1" : undefined}>
                <ShotFrame path={f.path} src={f.src} alt={f.alt} />
              </div>
            </div>
          </section>
        ))}

        {/* ── Who built it ───────────────────────────────────────────────── */}
        <section className="border-t border-brand-rule">
          <div className="mx-auto w-full max-w-6xl px-6 py-16">
            <div className="rounded-2xl border border-brand-rule-strong border-l-4 border-l-brand-gold bg-brand-panel p-8 sm:p-10">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-center lg:gap-12">
                <div>
                  <p className="font-heading text-sm font-semibold uppercase tracking-[0.14em] text-brand-gold-deep">
                    Who&apos;s Brian?
                  </p>
                  <h2 className="mt-3 font-heading text-balance text-2xl font-semibold tracking-tight text-brand-navy sm:text-3xl">
                    Brian builds software that replaces the software you rent.
                  </h2>
                  <p className="mt-4 max-w-2xl leading-relaxed text-brand-ink-muted">
                    This CRM is one of his. It exists because leisure agents kept
                    losing deals to systems that couldn&apos;t tell a wet-led bar
                    from a warehouse — so he built one that could. It&apos;s free
                    to start with. If you&apos;d rather he built something around
                    how your own business actually works, that&apos;s £1,000 to
                    build it, then half of whatever your current software costs
                    you.
                  </p>
                </div>
                <div className="lg:justify-self-end">
                  <a
                    href="https://getbrian.xyz"
                    target="_blank"
                    rel="noopener"
                    className={cn(CTA_QUIET, "w-full gap-2 sm:w-auto")}
                  >
                    See what else Brian&apos;s built
                    <ArrowUpRight className="h-4 w-4" aria-hidden />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Closing CTA ────────────────────────────────────────────────── */}
        <section className="bg-brand-navy text-white">
          <div className="mx-auto w-full max-w-6xl px-6 py-20 text-center">
            <div className="mx-auto flex max-w-2xl flex-col items-center">
              <Handshake className="h-8 w-8 text-brand-gold-light" aria-hidden />
              <h2 className="mt-5 font-heading text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                The next good pairing in your patch is sitting in a spreadsheet.
              </h2>
              <p className="mt-4 max-w-xl text-pretty leading-relaxed text-white/80">
                Put your listings and requirements in one place and let
                MatchMaker show you what you&apos;ve been missing.
              </p>
              <div className="mt-8">
                <Link href="/sign-up" className={CTA_GOLD_ON_NAVY}>
                  Create your free account
                </Link>
              </div>
              <p className="mt-4 text-sm text-white/70">
                Under a minute. No card.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer>
        <div className="border-b border-brand-rule bg-brand-panel">
          <div className="mx-auto w-full max-w-6xl px-6 py-10">
            <p className="font-heading text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink-subtle">
              More from Brian
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {SIBLINGS.map((s) => (
                <a
                  key={s.name}
                  href={s.href}
                  target="_blank"
                  rel="noopener"
                  className={cn(
                    "group flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-brand-rule bg-white px-4 py-3",
                    "transition-colors duration-200 hover:border-brand-navy-bright",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy-bright focus-visible:ring-offset-2",
                  )}
                >
                  <span className="min-w-0">
                    <span className="flex items-baseline font-heading text-sm font-semibold text-brand-navy">
                      Brian
                      <span
                        aria-hidden="true"
                        className="mx-1.5 inline-block h-[0.85em] w-px self-center bg-brand-navy-bright"
                      />
                      <span className="truncate font-medium text-brand-ink-muted">
                        {s.name}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-brand-ink-subtle">
                      {s.tag}
                    </span>
                  </span>
                  <ArrowUpRight
                    className="h-4 w-4 shrink-0 text-brand-ink-subtle transition-colors duration-200 group-hover:text-brand-navy"
                    aria-hidden
                  />
                </a>
              ))}
            </div>
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-brand-ink-subtle sm:flex-row">
          <BrandLockup />
          <span>
            Built for leisure &amp; licensed-sector agents ·{" "}
            <a
              href="https://getbrian.xyz"
              target="_blank"
              rel="noopener"
              className="font-medium text-brand-navy-soft underline-offset-4 hover:underline"
            >
              Built by Brian
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
