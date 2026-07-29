# Design System — Brian | CRM (app layer)

> **This file is no longer the source of truth for brand.**
> Colour, typography, and logo are governed by the **GetBrian brand field guide**
> (v3, July 2026) at `C:\Users\clift\Ai-Projects\CliftonAi\docs\brand-book.html`.
> Where this file and the brand book disagree, **the brand book wins.**
>
> What remains here is the app-specific layer the brand book doesn't cover: density,
> component patterns, data-table behaviour, and the a11y gates. The brand book is a
> brand document — it says nothing about how a 40px table row should behave.

> **LOGIC:** When building a page, first check `design-system/slc-crm/pages/[page].md`.
> If it exists, its rules **override** this file. Otherwise follow this file, and the
> brand book above it.

**Project:** Brian | CRM — B2B CRM for the UK leisure & licensed commercial-property sector
**Style:** Minimalism & Swiss — clean, dense, functional, grid-based, high-contrast
**Reference feel:** Kato / Linear / modern property-tech (utilitarian, trustworthy, fast)
**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui
**Surface:** desktop-first internal tool (data-dense), responsive down to tablet/mobile

---

## 1. Design principles

1. **Density with air** — show a lot without clutter. Tight, consistent spacing; let whitespace and hairline borders (not shadows) do the separating.
2. **Legibility first** — numbers, money, areas and references are the product. Tabular, monospaced figures; never let type styling fight the data.
3. **Calm chrome, loud data** — UI furniture (nav, toolbars) is neutral; colour is reserved for status, meaning and the single primary action.
4. **One primary action per view** — navy primary button. Everything else is secondary/ghost.
5. **Status is colour-coded and labelled** — colour is never the *only* signal (a11y); always pair with text/icon.
6. **Keyboard-first** — this is a tool used all day. Visible focus rings, logical tab order, `/` to search, shortcuts where sensible.

---

## 2. Colour — see the brand book

The palette is the **Brian ramp**, defined once in `src/app/globals.css` and documented in
chapter 03 of the brand book. Don't restate hex values here; read them from `globals.css`,
which carries the contrast figures inline.

Three rules govern everything and are the ones people break:

1. **Navy is the workhorse, gold is a shout.** `--primary`, the sidebar, focus rings and
   links are all navy. Gold appears in app chrome *only* as `--warning`, where "pay
   attention" is the entire point. Don't reach for gold to make something look branded.
2. **Gold has four values doing four jobs.** Brian Gold `#BA8B32` is 3.1:1 on white — a
   fill and logotype colour only, never body text. Small gold text on white takes Gold
   Deep; hover fills take Gold Hover; on navy grounds gold becomes Gold Light. Never
   substitute one for another "to match the logo".
3. **`--brand-*` tokens do not flip in dark mode, by design.** They are brand constants.
   The semantic tokens (`--primary`, `--card`, …) *do* flip. Public pages are built from
   `--brand-*` plus `.brand-surface` so they stay ink-navy/gold-on-white for a visitor
   whose OS prefers dark; app chrome is built from the semantic tokens so it themes.

### Domain badge palettes (CRM-specific — always label + colour)

These are **categorical** colours for meaning, deliberately independent of the brand
ramp — a status palette needs hues that are distinguishable from each other, which is a
different job from brand identity. Implemented as a typed map in `src/lib/badges.ts`,
not ad-hoc classes, so colour↔meaning stays consistent.

**Listing status:** Available → emerald · Under Offer (U.O.) → amber · Let → sky · Sold → violet · Withdrawn/Unavailable → slate.

**Deal stage (sequential, warm-to-cool):** Lead → slate · Viewing → sky · Offer → amber · Heads of Terms → indigo · Legal → violet · Completed → emerald · Fell through → red.

**Use class:** E (Commercial/Business/Service) → sky · Sui Generis–Pub/Bar → violet · Sui Generis–Nightclub → indigo · Sui Generis–Hot-food takeaway → orange · Legacy A3/A4/A5 → slate (with the letter shown).

**Premises licence:** Held → emerald (with hours) · Late licence → teal · None → slate-outline.

**Tenure:** Freehold → emerald · Leasehold → sky · Assignment → amber · New letting → teal.

> **Known inconsistency:** `teal` is currently doing double duty as the *default positive*
> tone (match scores ≥50%, operator companies, CDG listings) as well as a categorical hue.
> That was a fit with the old trust-teal brand and now reads as leftover on the densest
> screens. Retoning the default-positive uses to navy is an open item; the genuinely
> categorical uses can stay.

---

## 3. Typography — see the brand book

- **Headings:** **Space Grotesk** — `font-heading`, loaded in `src/app/layout.tsx`.
- **UI / body:** **DM Sans** — `font-sans`.
- **Numeric / tabular / references:** **Geist Mono** — `font-mono`. Money, sq ft / sq m,
  covers, rates, dates, IDs, postcodes. Use `font-variant-numeric: tabular-nums`.

The brand book fixes the first two and is silent on mono, which is why mono stayed Geist.
Note the wordmark itself is drawn artwork; setting "Brian" as live text in Space Grotesk
Semibold (as `BrandLockup` does) is a deliberate near-match so the name stays selectable
and indexable — for presentational uses take `brian-wordmark.svg` instead.

| Role | Size | Weight | Line-height | Notes |
|---|---|---|---|---|
| Display (marketing h1) | 36–48px | 600 | 1.1 | Public pages only |
| Page title (h1) | 24px | 600 | 1.25 | App page header |
| Section (h2) | 18px | 600 | 1.3 | Card/section headers |
| Subsection (h3) | 15px | 600 | 1.4 | |
| Body / default UI | **14px** | 400 | 1.5 | Desktop tool base |
| Body (marketing/long-form) | 16px | 400 | 1.6 | Public/auth pages |
| Label / meta | 12–13px | 500 | 1.4 | Uppercase tracking-wide for table headers |
| Data (mono) | 13–14px | 500 | 1.4 | `tabular-nums` |

> **Mobile a11y:** form `<input>`/`<textarea>` font-size **≥16px** to prevent iOS zoom,
> even though the desktop UI base is 14px. Marketing body copy is 16px, not 14px.

---

## 4. Spacing, radius, shadow, motion

- **Spacing:** 4px base — `1=4 2=8 3=12 4=16 6=24 8=32 12=48`. Default control padding `px-3 py-2`; card padding `p-4`/`p-6`; page gutter `px-6`.
- **Radius:** `--radius` = `0.5rem` (8px) default; sm 6px (badges/inputs), lg 12px (cards/modals), full (avatars/pills).
- **Shadow (restrained — Swiss prefers borders):** `sm` `0 1px 2px rgb(0 0 0/0.04)` for raised buttons; `md` `0 4px 12px rgb(0 0 0/0.08)` for popovers/dropdowns; `lg` `0 12px 32px rgb(0 0 0/0.12)` for modals. Cards use **border, not shadow**, by default.
- **Motion:** 150–200ms `ease-out` for hovers/menus; 200–250ms for dialogs. Animate `opacity`/`transform`/`background-color` only. Respect `prefers-reduced-motion`.

---

## 5. Component patterns

**App shell:** fixed left **sidebar** (240px) + **top bar** (56px: global search, create, notifications, account) + scrollable content (`max-w` none for tables; `max-w-3xl` for forms). The sidebar and mobile drawer both open with `BrandLockup tone="app"`.

**Sidebar nav:** grouped sections (Workspace / CRM / Dealflow / Settings). Item = icon + label, 36px tall, `rounded-md`; active = primary text + `--sidebar-accent` fill; hover = muted fill. Lucide icons, 18px.

**Data table** (the workhorse): sticky header (`--muted`, 12px uppercase labels), 40px rows (compact mode 32px), hairline row borders, zebra optional, hover row highlight, checkbox column for bulk actions, right-aligned numeric/mono columns, sortable headers, sticky first column on overflow, `overflow-x-auto` wrapper. Bulk action bar appears on selection. Empty state with icon + primary CTA. Always offer pagination or virtualization for >100 rows.

**Filter bar:** above tables — segmented/pill filters + search + faceted dropdowns (town, use class, status, tenure, £ range, sq ft range). Active filters render as removable chips; "Clear all".

**Cards:** `border` + `rounded-lg` + `p-4/6`, header (h2 + optional action), no default shadow; hover only if the whole card is a link (then `cursor-pointer` + subtle border/bg change, **no layout-shifting scale**). Note `CardContent` zeroes top padding at `sm:` and up — headerless form cards need `pt-4 sm:pt-6`.

**Forms:** single column, grouped fieldsets, labels above inputs, 16px inputs, helper/error text below, required `*`, validate on blur, inline errors near field, sticky save bar on long forms, disabled+spinner on submit.

**Badges/pills:** `rounded-md`/`rounded-full`, 12px, 500 weight, tint fill + darker text per the domain palettes above; always include a text label (never colour-only).

**Activity timeline:** vertical line, dot per event (type-coloured), actor + verb + target + relative time; group by day.

**Buttons:** primary (navy solid) · secondary (outline) · ghost (text) · destructive (red). 36px default height in-app, ≥44px on public pages, `rounded-md`, `cursor-pointer`, focus-visible ring.

**Toasts/feedback:** bottom-right, status-coloured left border + icon; loading→success/error on all mutations.

### Generated PDFs are a different brand

`src/lib/pdf/*` renders **CDG Leisure's** identity, not Brian's — those documents go out
under the client agency's name, so they keep CDG's teal `#1ab6b6` and their own type. The
colours are hard-coded in those files rather than read from tokens, precisely so a
product-brand change can't leak into client-facing particulars. Don't "fix" them to match
the app. INTEL listings render an unbranded variant with no CDG marks at all.

---

## 6. Accessibility & quality gates (enforced pre-delivery)

- [ ] Contrast ≥ 4.5:1 body / 3:1 large & UI; **colour never the only signal**
- [ ] Visible `focus-visible` rings (`--ring`, Navy Bright) on every interactive element
- [ ] Icon-only buttons have `aria-label`; images have alt; inputs have `<label for>`
- [ ] Tab order matches visual order; menus/dialogs keyboard-operable + focus-trapped
- [ ] Touch targets ≥ 44px on mobile; `cursor-pointer` on all clickables
- [ ] `prefers-reduced-motion` respected; no autoplay media
- [ ] Tables: `overflow-x-auto`, header `scope`, caption/`aria` where useful
- [ ] Responsive at 375 / 768 / 1024 / 1440; no horizontal page scroll on mobile
- [ ] Dark mode verified (borders & muted text visible in both themes)
- [ ] Public pages verified with `.dark` forced on `<html>` — they must stay light

## 7. Anti-patterns (do NOT use)

- ❌ Semantic tokens (`bg-card`, `text-muted-foreground`) inside `src/app/page.tsx` — the public page must be built from `--brand-*` or it half-flips in dark mode
- ❌ Brian Gold as body text, captions or icon labels (3.1:1) — small gold text on white is Gold Deep only
- ❌ Deleting the mark's gold traces, or using `brian-mark-solo.svg` on its own — without traces the B reads as a "3"
- ❌ The display mark below 40px — use the compact cut
- ❌ Hand-editing `public/brand/*` — it's generated in the CliftonAi repo by `npm run brand`
- ❌ Retoning the PDF templates to the app palette — they're CDG's brand
- ❌ Display serifs / luxury brochure fonts — this is a tool
- ❌ Landing-page "conversion" patterns inside the app
- ❌ Emojis as icons (use Lucide SVG)
- ❌ Shadow-heavy "card soup" — prefer borders; reserve shadow for floating layers
- ❌ Colour-only status; low-contrast body text in light mode
- ❌ Layout-shifting hover scales; instant (un-transitioned) state changes
- ❌ Proportional figures in data columns (use `tabular-nums` mono)
- ❌ Full-width form fields stretched across the whole screen (cap at `max-w-3xl`)
