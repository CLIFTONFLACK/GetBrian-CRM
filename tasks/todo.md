# SLC-CDG-CRM — Leisure Real Estate CRM (Kato-for-Agencies clone)

A commercial-property agency CRM for the UK **leisure & licensed sector** (restaurants,
bars, clubs, coffee shops). Modeled on Kato for Agencies, with a leisure-specific
domain layer.

- **Market / regulatory model:** UK (Use Classes E / Sui Generis, Licensing Act 2003)
- **Stack:** Next.js (App Router, TypeScript) + Supabase (Postgres, Auth, Storage, RLS)
- **MVP scope:** CRM + Listings + Requirements + Matching engine
- **Later phases:** Marketing engine, ~~Deal pipeline / Heads of Terms~~ (✅ Phase 6), Client portals, Insights

## Phase 6 — Deal pipeline ✅ (schema already existed; built UI + actions)
- [x] Kanban board at `/deals` — one column per `deal_stage` (lead → viewing → offer →
      heads_of_terms → legal → completed → fell_through), per-card stage mover (native
      `<select>` → `updateDealStage`, no DnD dependency), count + indicative value per card
- [x] Deal detail `/deals/[id]` — linked listing / requirement / operator cards + editable
      form (title, stage, value, Heads of Terms, notes) via `updateDeal`; delete
- [x] `src/lib/actions/deals.ts` — `createDealFromMatch`, `updateDealStage`, `updateDeal`, `deleteDeal`
- [x] Verified: `tsc` clean · `eslint` clean · `next build` OK (`/deals`, `/deals/[id]` = ƒ)
- [ ] Live run-through against seed data (needs Supabase auth + a created deal) — pending

---

## Domain model (UK leisure)

Core entities (supply ↔ demand spine):

- **Company** — operators (restaurant/bar groups), landlords, agents, vendors. `type`, sector tags.
- **Contact** — people, linked to a Company; role (acquisitions, landlord, solicitor).
- **Listing (Unit)** — a leisure premises being marketed.
  - Address, lat/lng, town, region, floor area (sq ft / sq m), frontage width
  - **Use class** (E, Sui Generis: pub/bar/nightclub/hot-food-takeaway; legacy A3/A4/A5)
  - **Premises licence** (held Y/N, hours, capacity, conditions), late licence
  - **Covers** (internal + external/pavement), kitchen extraction, 3-phase power, gas
  - **Tenure** (freehold / leasehold / assignment / new letting), tied vs free-of-tie
  - Rent, premium, F&F value, goodwill, rateable value, EPC, service charge
  - Existing trade (turnover / barrelage), status (available / U.O. / let / sold)
- **Requirement (Acquisition brief)** — what an operator wants.
  - Target towns/regions, sq ft band, covers band, use class needed, max rent/premium,
    tenure preference, demographics/footfall, proximity to anchors/competitors, notes
- **Deal** — links Listing + Requirement + parties; stage pipeline; Heads of Terms.
- **Activity** — calls, emails, viewings, notes; polymorphic link to any entity.
- **Match** — generated supply↔demand candidate with a score + reasons.

---

## Phase 0 — Project scaffolding
- [x] `create-next-app` (TypeScript, App Router, Tailwind v4, ESLint) — Next.js 16.2.9, React 19
- [x] Wire GitHub (`slapharma/SLC-CRM`) + Vercel (`slc-crm`) — auto-deploy on push to `main` (live at slc-crm.vercel.app)
- [x] Run **ui-ux-pro-max** skill → design system at `design-system/slc-crm/MASTER.md`
- [x] Research Next 16 / Tailwind v4 / shadcn / `@supabase/ssr` conventions → build playbook (workflow)
- [x] Add Supabase client (`@supabase/ssr`) — client/server/proxy, env-guarded, `.env.example` (go-live needs a provisioned project)
- [x] App shell: root layout, sidebar nav, top bar, Tailwind v4 theme tokens, light/dark mode
- [x] Auth (login/signup/logout) + protected `(app)` route group — code complete; org/tenant scoping lands with Phase 1 RLS
- [x] CI: typecheck + lint + build (GitHub Actions)

**Gate:** provision Supabase (new cloud project vs. existing) → set `NEXT_PUBLIC_SUPABASE_*` in Vercel → auth goes live. Then Phase 1 schema.

## Phase 1 — Data layer (Supabase) ✅ applied to project `akxortffkrknoxysgeei`
- [x] Schema migration: agencies + members, companies, contacts, **disposals** (the supply/Listings table), requirements, deals, activities, matches
- [x] Enums for UK use classes, licence, tenure, deal/requirement/match stages, roles, activity & entity types
- [x] Row-Level Security (per-agency isolation via `auth_agency_ids()`) + admin/agent roles. Functions hardened (`0003`) per security advisor
- [x] Generated TypeScript types → `src/lib/database.types.ts`; Supabase clients typed `<Database>`
- [x] Seed data: on signup, `handle_new_user` auto-creates the user's agency + admin membership + sample companies/disposals/requirements (`seed_agency`)
- [x] **Reconciled `disposals` = Listings** (merge of the parallel CDG-import workstream): one tenant-scoped `disposals` table (rich CDG schema + `agency_id`/RLS + Storage), dropped the thin `listings`, repointed deals/matches, CDG importer made agency-aware (`0004`/`0005`). Verified: A sees 2/4 disposals (own agency only)

## Phase 2 — CRM core
- [x] Companies: list (search/filter), detail, create/edit/delete — server actions + RLS-scoped queries; verified live (list/search/insert pass RLS)
- [x] Contacts: list (search), detail, create/edit/delete — linked to companies (clickable + "Add contact"); verified live (insert passes RLS)
- [x] Activity timeline — log + view per record (reusable component, on companies) + recent activity feed + live KPI counts on the dashboard
- [x] Global search — top bar → `/search` across companies / contacts / listings / requirements

## Phase 3 — Listings / disposals (supply)
- [x] Listing list (search by title/town) with status/use-class/size/rent columns
- [x] Listing detail: full leisure attribute set, commercials, agent, images, lossless marketing sections, brochure + source link
- [x] CDG import box on the listings page (agency-scoped) via the import action/route
- [ ] Manual create/edit form (import is the primary path — deferred) + map view (lat/lng)

## Phase 4 — Requirements (demand) ✅ (brought forward — drives matching)
- [x] Requirement list (search) + detail + create/edit/delete
- [x] Linked to operator Company; surfaced on the company record ("Add requirement")
- [x] **All matchable options vs disposals** (migration `0006`): target towns/regions, property_types,
      use_classes, size & covers bands, tenure, max rent/premium/guide-price, fit-out — every field
      maps to a disposal column for the Phase 5 matching engine

## Phase 5 — Matching engine (differentiator)
- [x] Scoring function `scoreMatch` (location, size/covers bands, use class, property type, tenure, rent/premium/guide, fit-out — weighted 0–100 with per-dimension reasons)
- [x] "Matching listings" on a requirement + "Matching requirements" on a listing + agency-wide `/matches` (50%+ pairs)
- [x] Match reasons surfaced (✓/✗ chips per dimension)
- [x] **One-click create Deal from a match** — `CreateDealButton` on the Matches page,
      requirement detail (matching listings) and listing detail (matching requirements).
      `createDealFromMatch` de-dupes on the (requirement, listing) pair, derives title +
      indicative value (guide → premium → rent), links the operator company, seeds stage `lead`.
- [ ] (stretch) LLM-assisted match explanations

## Verification (each phase)
- [ ] Manual run-through against seed data
- [ ] RLS tested (no cross-tenant leakage)
- [ ] Typecheck + lint clean

---

## Active task — CDG Leisure → `disposals` extractor (feeds Phase 3 Listings)

Turn a CDG Leisure property URL into a structured, insert-ready `disposals` row.

**Key finding:** CDG runs on the **Agents' Society** platform. Every field is embedded
in the page HTML as one JSON object passed to `AI.mapBox.init('<token>', [ {…} ], 'map')`.
We parse that object directly — no fragile DOM/table scraping — and it exposes fields
not shown in the UI (`rateable_value`, `business_rates`, `service_charge`,
`estate_charge`, `parking_charge`, `lat`/`lng`, full agent record, per-floor unit
table, all marketing sections). This maps 1:1 onto the Listing (Unit) model above.

- [x] `src/lib/disposals/cdg.ts` — self-contained (types + parser + mapper); no Next /
      Supabase imports so it runs and tests anywhere.
  - [x] `extractCdgProperty(html)` — string-aware scan to carve the JSON array out of
        `AI.mapBox.init(...)`, `JSON.parse`, return first record.
  - [x] `mapCdgToDisposal(raw, sourceUrl)` — map + derive: money (amount + period +
        qualifier), lease (term/expiry/review/1954-Act), covers (internal/external),
        use class, EPC, agent, images, brochure, key features, lossless `sections[]`.
  - [x] `fetchAndExtractCdg(url)` — fetch + extract + map.
- [x] Verify against live 311 West End Lane (ref 378436): rent 50000, premium 95000,
      650 sqft / 60.39 sqm, 24+16 covers, lease→Jun 2041, Class E, agent David Kornbluth.

**Result:** `scripts/verify-cdg.ts` — 34/34 checks pass against both the saved fixture
and the live URL. `npx tsc --noEmit` and `eslint` clean. `scripts/` excluded from
`tsconfig` so the harness's `.ts`-extension import can't break `next build`.

### Persistence + image re-hosting (in progress)
Constraints: **no service-role key** (only anon + URL) → server-side writes run as the
authenticated user, so the table and Storage bucket both need `authenticated` RLS
policies. Next 16 confirmed: `params` is a Promise; `cookies()`/`headers()` async;
route handlers/`fetch` uncached by default; server functions must self-verify auth.

Build (verified locally — no live cloud writes):
- [x] `src/lib/disposals/image.ts` — `cleanImageUrl()` (drop imgix `mark*` watermark
      params), `filenameFromUrl()`, `contentTypeFromName()`. Pure + unit-checked (5/5).
- [x] `src/lib/disposals/storage.ts` — `rehostMedia(row, supabase)`: download clean
      image → upload to `disposals` bucket → rewrite `images[].url` to the public URL,
      keep `source_url` for provenance. Media failures non-fatal.
- [x] `src/lib/disposals/import.ts` — `importDisposalFromUrl(url, supabase, {rehost})`:
      fetch+extract+map → optional re-host → upsert on `(source, source_ref)`.
- [x] `src/lib/disposals/actions.ts` — `"use server"` `importDisposal(prev, formData)`
      (matches auth.ts: config guard → auth guard → import → revalidate `/listings`).
- [x] `src/app/api/disposals/import/route.ts` — `POST {url}`, auth-guarded, `Response.json`.
- [x] `supabase/migrations/20260624094649_disposals.sql` — table (cols = `DisposalInsert`,
      jsonb for sections/images/floors, `unique(source, source_ref)`), `updated_at`
      trigger, RLS (authenticated-all for now; tenant-scope is Phase 1), public
      `disposals` Storage bucket + authenticated write policy.
- [x] Verify: image helpers 5/5, extractor 34/34, `tsc` clean, `eslint` clean,
      `next build` OK — `/api/disposals/import` registers as a dynamic route (ƒ).

**Not yet applied to the live project (needs sign-off):** running the migration (creates
table + bucket + RLS), and a real end-to-end import insert. SQL not yet executed against
a DB. Import UI on the Listings page also still to do.

Note: re-hosting strips CDG's watermark from their marketing photos — fine if CDG is
your own brand; a content-ownership question if it's a third party. Flagged, your call.

**Out of scope until confirmed:** creating the `disposals` table in Supabase (no DB
writes without sign-off); server action / API route to persist (will read
`node_modules/next/dist/docs/` first per AGENTS.md); bulk crawling of CDG (ToS — your call).

## Review
_(to be filled in as phases complete)_

---

# UPGRADES BATCH (17 items) — phased plan

Phased delivery; each phase ends with a build/lint check + quick verification before the next.

**Patterns to follow:** Listings = `disposals` table. Server actions in `src/lib/actions/*`; client-component forms in `src/components/*`. Multi-tenant RLS by `agency_id` (`currentAgencyId()`, `getAgencyMembers()`). Agent ownership = `lead_agent_id` + `*_agents` join tables; `activities` = polymorphic timeline. UI primitives in `src/components/ui/*`. DB keeps internal names `requirements`/`requirement`; only UI copy becomes "Enquiries".

**Scoping decisions (adjust on approval):**
- #3 route: rename `/requirements` → `/enquiries` (+ redirect); table names unchanged.
- #11 notifications/share: in-app notifications + reminders/deadlines in DB; "share by email/WhatsApp" = prefilled `mailto:` / `wa.me` links (no mail/WhatsApp backend exists).
- #4 Post to CDG: no public CDG submission API — formatted "Post to CDG" export/copy; Share = Web Share/copy link; Print = print view.
- #7: remove the CDG-import UI from the Listings page (keep scraper lib/scripts).
- Migrations: written to `supabase/migrations/`, applied to the linked Supabase project via MCP after a cost/safety confirm.

## Phase 0 — Schema + global rename
- [x] Migrations applied to live DB: `manager` enum value; `contacts.marketing_opt_in`; `disposal_documents` + `disposal-docs` bucket; `disposal_areas`; `deal_reminders` + `notifications`; `database.types.ts` regenerated (by parallel session)
- [x] #9a manager role in admin dropdowns + `asRole()`; 2 manager users seeded (agent4=Daniel Goldberg, agent5=Rachel Stein, Demo!2026)
- [x] #3/#5 copy relabel: all user-facing "Requirements"→"Enquiries", "Matching requirements/listings"→"MatchMaker Opportunities", "Matches" page→"MatchMaker Opportunities" (sidebar, list/new/edit/detail, form, dashboard, search, top-bar, company detail, listing detail, deals, landing)
- [x] #3 route move `/requirements`→`/enquiries`: folder moved (git mv), all route strings + sidebar NAV + revalidatePath + activities PATH updated (action MODULE path kept), `/requirements*`→`/enquiries*` redirect in next.config
- [x] Verified: tsc + eslint clean AND clean `next build` passes (all routes incl. /enquiries/*, /listings/new, /listings/[id]/edit present)

## Phase 1 — Records CRUD & relationship modals (#1, #12, #13, #14, #15)
- [x] #15 New Listing: button on Listings page + `disposal-form.tsx` + `createDisposal` action + `/listings/new`
- [x] #1 Edit Listing: `/listings/[id]/edit`, Edit button on detail, pen icon on each list row, `updateDisposal`
- [x] Reusable modal pattern: `ui/modal.tsx` (portalled) + `creatable-select.tsx` (CreatableSelect + Company/Contact wrappers) + `quickCreateCompany`/`quickCreateContact` actions (return `created` in FormState)
- [x] #13 New Company: "Add contact" field with "+ New contact" modal; `createCompany` links chosen contact via `link_contact`
- [x] #14 New Contact: company dropdown → "+ New company" modal; "Approves marketing communications" checkbox (`contacts.marketing_opt_in`)
- [x] #12 Enquiries form: operator company dropdown → "+ New company" modal
- [x] tsc clean — [ ] eslint (pending classifier) — [ ] browser verification (deferred to when other dev server stops, alongside route move)

## Phase 2 — Listings enhancements (#2, #4, #7, #10) — DONE (tsc+eslint clean)
- [x] #7 removed CDG-import block from Listings page (import-disposal-form.tsx now orphaned; scraper lib/scripts kept)
- [x] #2 PDF uploads: `disposal-documents.tsx` (upload to private `disposal-docs` bucket client-side → `addDisposalDocument`; signed-URL download; delete) + `disposal-documents` action file
- [x] #10 available-area schedule: `disposal-areas.tsx` editable table + `addDisposalArea`/`deleteDisposalArea`; "Available area" card on listing detail
- [x] #4 Share / Print / Post-to-CDG: `listing-share-actions.tsx` (Web Share/copy-link · window.print · copy particulars for CDG) in listing header
- [x] tsc + eslint clean — [ ] browser verification deferred

## Phase 3 — List sorting & filtering (#6) — DONE (tsc+eslint clean)
- [x] Shared `lib/sort.ts` + `sort-header.tsx` (URL-driven sortable column links) + `filter-bar.tsx` (`FilterBar` + `FilterSelect`, GET form preserving sort)
- [x] Companies (sort name/type; filter type), Contacts (sort name/role; filter role), Enquiries (sort title/max_rent/status; filter status), Listings (sort title/city/use_class/size/rent/status; filter status + disposal_type)

## Phase 4 — MatchMaker (#16) — DONE (tsc+eslint clean)
- [x] Stats bar (active enquiries · live listings · opportunities · avg score) + filters (min score, town/name keyword, use class)

## Phase 5 — Deals deep feature (#11, #17) — DONE (tsc+eslint clean)
- [x] #17 cards: created date + owner agent + "View deal" button on each kanban card
- [x] Detail: created date + owner in header; share buttons (email/WhatsApp via `deal-share-actions.tsx` + `logDealShare`)
- [x] Chronological updates/notes timeline (reuses LogActivityForm + ActivityTimeline, entity_type 'deal')
- [x] Deadlines + reminders: `deal-reminders.tsx` + `deal-reminders` actions (add/toggle/delete); overdue flag computed server-side (lib/time.ts)
- [x] In-app notifications: `notifications-bell.tsx` in top bar (server-fetched initial via layout, re-reads on open); reminder creation notifies the deal owner

## Phase 6 — Admin bulk import + agent visibility (#8, #9b)
- [x] #8 CSV import for Companies/Contacts/Enquiries/Listings in Admin (`lib/csv.ts` parser+templates, `import-data.ts` action, `data-import.tsx` UI) + downloadable CSV templates per entity. (XLS → "save as CSV"; SheetJS could be added for native .xls.)
- [x] #9b verified: Companies, Contacts, Listings already show lead + additional agents. GAPS REMAINING:
      - Enquiries have NO agent fields in the schema (0007 only added agents to companies/contacts/disposals) → needs a migration (requirements.lead_agent_id + requirement_agents) + form/display wiring.
      - Listing PDF shows only the source/CDG agent (agent_name), not the internal lead/additional agents → needs particulars-document + route change.
- [x] Verified: tsc + eslint clean AND full `next build` green (Phases 0–6)

## #9b completion — DONE (migration 0014 applied + build-green)
- [x] Enquiry agent assignment: migration `0014_requirement_agents` (requirements.lead_agent_id + requirement_agents table + RLS) applied to live DB; types regenerated
- [x] Enquiry form gains AgentFields (lead + additional); create/update actions sync requirement_agents; enquiry detail shows an "Agents" card
- [x] Listing PDF: "CDG Team" block lists internal lead + additional agents (particulars-document + route)

## Phase 7 — Heatmaps (added) — DONE (build-green)
- [x] Reusable `heatmap.tsx` (CSS-grid density matrix, teal scale, server-rendered)
- [x] Listings: town × status (driven by the page's existing status/type/search filters)
- [x] Companies: sector tag × company type (driven by the page's type/search filters)
- [x] Deals: stage × value band, with an agent filter

## FINAL STATUS
All 17 upgrade items + heatmaps + native .xls import implemented. Verified: tsc clean, eslint clean, full `next build` green; migrations 0011–0014 applied to live `slc-crm`.

Live browser verification (preview server, throwaway admin since the parallel session replaced demo logins with real CDG emails):
- Listings: New-listing button, Status/Type filters, town×status heatmap (live data), sortable headers, per-row Edit ✓
- New-listing form renders all sections + Lead/Additional agents ✓
- MatchMaker: stats bar (17/81/760/64%) + town/min-score/use-class filters + scored pairs ✓
- Admin: Import-data card, 4 entities, 4 templates, file inputs accept .xls, Manager role option ✓
- Deals: stage×value heatmap, agent filter, View-deal buttons; deal detail has Created date/agent, Reminders & deadlines, Updates & notes, Email/WhatsApp share ✓
- Enquiry detail: Agents card + Lead agent + MatchMaker Opportunities ✓
- KNOWN LIMITATION: server-action POSTs (create/edit) bounce to /login in the preview harness (cookie/Origin quirk) — could not exercise create/edit mutations there. Production build is green and the new mutations mirror existing working actions; confirm create/edit in a real browser.
- xlsx (SheetJS) added → npm audit reports advisories (2 moderate, 1 high) on the npm build; consider the CDN distribution if that matters.
- Throwaway verify-bot@slc.test account deleted after testing.

## Phase 7 — Heatmaps (added)
SVG/CSS heatmap visuals (no map/chart dep) rendered on each page, each with relevant filters.
- [ ] Reusable `Heatmap` component (matrix grid, colour-scaled cells, legend) + shared filter bar.
- [ ] Listings heatmap: density by **region/town × use class** (or status). Filters: status, use class, town/region, to-let/for-sale.
- [ ] Companies heatmap: density by **sector tag × company type** (or region). Filters: type, sector tag, lead agent.
- [ ] Deals heatmap: **stage × value band** (or stage × month). Filters: stage, lead agent, value band, date range.
- [ ] Build + lint

---

## Next session — requested backlog (cflack, 2026-06-30)

1. [ ] **Listings on company record cards** — show a company's related listings on its
       detail page (a "Listings" card alongside the existing Contacts/Activity cards).
       Source: `disposals` linked to the company; clickable rows through to each listing.
2. [ ] **Admin: edit contact role** — let an admin change a contact's role
       (acquisitions / landlord / solicitor / etc.) from the Admin area, not just the
       contact edit form. Mirror the existing Admin user/role editing pattern.
3. [ ] **Stats bar on Companies & Listings pages** — add a KPI/stats bar like the one
       already on Contacts (and MatchMaker's 17/81/760/64% bar). Counts/segments
       relevant to each page (e.g. companies by type; listings by status/use class).
4. [ ] **Contact on listings record** — add a contact (e.g. the landlord/agent contact)
       to a listing's detail, with a clickable link through to the contact record.
5. [ ] **External-source links in KYC report** — add links to Companies House (and other
       data sources) on the relevant data points in the KYC report.
6. [ ] **Deal record enrichment + named-deal creation flow**
       - [ ] Add lead agent + additional agents to deal records (reuse the AgentFields
             component already used on companies/contacts/listings/enquiries).
       - [ ] Show the deal's listing company + contact details with clickable links.
       - [ ] On "create deal", pop up a form to name the deal before creating
             (replace/extend the current `createDealFromMatch` flow with a title prompt).

---

# BATCH — Enquiries→Requirements rename, portfolio+map, links, listing type (cflack, 2026-07-01)

Decisions (from user this session):
- Enquiries page: **omit** geographic map (demand records aren't geographic) → portfolio-spread crosstab only.
- INTEL listing PDF: **neutral/unbranded + "Market intel — not for distribution"** marker.
- Route: **revert `/enquiries` → `/requirements`** (+ redirect the old path).
- Reuse the app's existing design system (Card · `Heatmap` crosstab · `ConcentrationMap` · Tailwind tokens) — no new design language.

Repo facts found during exploration (reduce the work):
- DB table is already `requirements` (only UI was renamed to "Enquiries" last batch — this reverses that).
- `disposals` + `requirements` already have `company_id` + `contact_id` columns.
- Listing form already has Company + Contact pickers; requirement form has Company but **not** Contact.
- "Portfolio Spread" == the `Heatmap` crosstab (`src/components/heatmap.tsx`); already on Listings + Companies.

## B1 — Enquiries → Requirements (site + route revert)
- [ ] `git mv src/app/(app)/enquiries` → `src/app/(app)/requirements` (4 pages).
- [ ] `next.config.ts` redirect flip: `/enquiries(/*)` → `/requirements(/*)`.
- [ ] Relabel all user-facing "Enquir…"/"enquiry" → "Requirement(s)" (sidebar, list/new/edit/detail, `requirement-form`, dashboard, `/matches`, deals, company detail, `/search`, top-bar, landing, admin, data-import).
- [ ] Update `/enquiries` → `/requirements` in actions (`requirements.ts`, `deals.ts`, `activities.ts` PATH, `import-data.ts`).
- [ ] CSV/import entity key `enquiries` → `requirements` (`csv.ts`, `import-data.ts`, `data-import.tsx`) — DB table mapping stays `requirements`.

## B2/B3 — Portfolio spread + geo map, compact 2-column
- [ ] `ConcentrationMap`: add optional `defaultActive?: MapKind` → initial active layer = page's category (toggles still work).
- [ ] `Heatmap`: compact variant (smaller cells) for side-by-side.
- [ ] Contacts page: 2-col — spread (role × company type) left, map (default contacts) right.
- [ ] Companies page: existing spread → 2-col + map (default companies).
- [ ] Listings page: existing spread → 2-col + map (default listings).
- [ ] Requirements page: add spread (target town × status), single column (map omitted).

## B4 — Contact + company fields on requirements + listings
- [ ] Listings: already wired — verify save + detail display.
- [ ] Requirements: add Contact picker to `requirement-form.tsx`; thread `contact_id` through `createRequirement`/`updateRequirement`; show company + contact on requirement detail.

## B5 — Listing primary type: CDG | INTEL
- [ ] Migration `0024_listing_type.sql`: `disposals.listing_type` text/enum `('cdg','intel')` default `'cdg'`; regen `database.types.ts`.
- [ ] "Type" selector in `disposal-form.tsx`; wire through disposal create/update action.
- [ ] CDG/INTEL badge on listing list + detail.
- [ ] Particulars PDF: thread `listing_type`; when `intel` → drop logo/phone/URL/CDG disclaimer, neutral header, add "Market intel — not for distribution".

## Verification
- [x] tsc + eslint + `next build` clean (twice — before and after review fixes).
- [x] Preview: /enquiries → /requirements redirect verified; /requirements + /dashboard render; Admin accordion + Add-agent toggle + Edit-company-types expand verified; CDG import panel gone from /listings.
- [ ] Full data verification of listings/company-types BLOCKED until migrations 0024+0025 applied to live DB (see below).

## Follow-on requests (same session)
- [x] Dashboard: 5 uniform quick-action buttons incl. "Add requirement"; recent-activity → listings location map; "Pipeline value" KPI (sum deal values).
- [x] Admin: Add-agent moved into Team panel header (inline form); "Edit roles" → "Edit contact roles"; new "Edit company types" panel (editable, migration 0025); all panels collapsible (CollapsibleCard); MS Outlook (email+calendar) connector placeholder.
- [x] Mandatory contact on every listing + requirement (form `required` + server validation + CSV import contact_email resolution); company optional on listings.
- [x] Removed "Import from CDG Leisure" panel from Listings page.

## Adversarial review (workflow, 6 dimensions × verify) — 4 real bugs found + FIXED
- [x] CSV import created listings/requirements with null contact_id → now resolves required `contact_email`.
- [x] seed `dummy_data.sql` referenced dropped `company_type` enum → changed to `text[]`.
- [x] CSV company `type` validated against stale enum → now against live `company_types` slugs.
- [x] `companyTypeBadge` shown stale labels for renamed types → threaded `typeLabel()` on companies list/detail, search, listing detail (+ tiles/heatmap derive from live types).
- Known limits (accepted): mandatory-contact enforced at app+CSV layer, NOT a DB NOT NULL (existing rows/CDG scraper have null contact_id); INTEL PDF keeps the teal accent (CDG wordmark/contact/disclaimer removed).

## ⚠️ ACTION REQUIRED — apply migrations to live DB (slc-crm / akxortffkrknoxysgeei)
Both were blocked by the production-safety gate; app is degraded until applied:
- `0024_listing_type.sql` — adds `disposals.listing_type` (additive, safe).
- `0025_company_types.sql` — converts `companies.type` enum→text, adds `company_types` table, DROPS `company_type` enum, seeds 5 defaults.
After applying: regenerate `database.types.ts` (hand-edits already match), and re-run `dummy_data.sql` only if resetting demo data.

## Review
Shipped Enquiries→Requirements rename, portfolio-spread+geo-map across list pages, contact/company links, listing CDG/INTEL type + unbranded INTEL PDF, dashboard refresh, Admin accordion redesign + editable company types, and mandatory-contact enforcement. All gated behind two DB migrations awaiting authorization.

---

# BATCH — UK locations dropdowns + county field + proximity MatchMaker (cflack, 2026-07-21)

Plan: C:\Users\clift\.claude\plans\wise-plotting-sphinx.md

- [x] 1. Dataset: scripts/build-uk-locations.mjs (doogal districts CSV single source + curated regions/counties/area→county map) → 2,944 districts / 1,448 towns / 71 counties in src/lib/locations/data/*.json (server 463KB + client-safe 82KB split)
- [x] 2. Locations lib: src/lib/locations/index.ts (server-side, geocode.ts comment convention) + options.ts (client-safe)
- [x] 3. Migration file 0026 written + database.types.ts hand-updated (5 new columns) — ⚠️ NOT applied to live DB: Supabase MCP returns "You do not have permission" (connection lacks access, like the Vercel MCP 403)
- [x] 4. UI: ui/slider.tsx + location-select.tsx (LocationSelect single + LocationMultiPicker chips) + target-locations-field.tsx
- [x] 5. Forms + actions (requirement, disposal, contact, company) with deriveCounty fallback on save
- [x] 6. List-page filters: Town + County (incl. "Home Counties") on listings/contacts/companies; Target location on requirements
- [x] 7. Proximity scoring in score.ts (exact=1.0; decay ≤0.8 cap; flex 0–100 → radius (flex/100)×25mi; W1 prefix-average centroid) + amber partial chips in match-reasons
- [x] 8. Slider wiring ?flex= on /matches FilterBar + requirement/listing detail match cards
- [x] 9. CSV templates + import (county, target_counties, target_postcode_districts)
- [x] 10. Verify: tsc CLEAN · eslint CLEAN · `next build` GREEN (all routes) · W1→W2 math verified against dataset (13 W1 sub-districts, centroid 1.99 mi from W2 → 17/25 pts at flex 50, 0 at flex 0; GU1→Surrey derivation ✓)

## Review
Shipped structured UK locations end-to-end: repo-bundled dataset (doogal OGL districts + curated counties/regions, split server/client JSON), searchable comboboxes on every postcode/town/county field (free text always allowed), unified Target-locations multi-select on requirements, Town/County/"Home Counties" filters on all list pages (county derived at read time for legacy rows), CSV import/template support, and proximity-aware MatchMaker scoring (exact hit = full 25 pts; near-miss decays linearly within a slider-controlled radius, capped at 0.8× so proximity never beats exact; ?flex= slider on /matches + both detail pages).

## Migration 0026 — APPLIED ✅ (user re-authed the Supabase connector)
Columns confirmed live; 103 disposals intact. Live verification via throwaway QA agency (qa-w1test-0721@slc.test, isolated — left in place):
- New listing "Paddington test bar" (city London, postcode W2 1AA, county left blank) → saved with county **Greater London** auto-derived server-side ✓
- Listings page shows new Town + County filter dropdowns; county for legacy NULL rows derived at read time ✓
- Requirement "Central London bar brief (W1)" saved with target_postcode_districts=['W1'] ✓
- /matches?flex=0 → W1D listing matches exactly ("Location: W1D"), W2 listing absent ✓
- /matches?flex=50 → W2 + NW1 listings surface with "~1 mi from W1" partial (amber) chips ✓
- Bug found & fixed during verification: formatValue function prop crossed the RSC boundary → new client wrapper `location-flex-slider.tsx` (used on /matches + both detail pages)
- Harness note: the preview pane ran pages without paint/hydration — combobox interaction untestable there (native form POSTs fine); combobox visuals worth a quick manual click-through in a real browser.

---

# BATCH — employee-flow findings build-out (cflack, 2026-07-22) — everything except the money model

Source: docs/employee-flow-test-2026-07-22.md. Migration numbers assigned centrally:
0028 tasks + reminder firing columns · 0029 deal_stage_events + expected_close · 0030 message threading · 0031 intake triage · 0032 external_sends tracking · 0033 listing images (only if storage policy needed).

## Phase 1 (parallel)
- [ ] A — CRM records: search escape + email search, duplicate warnings, quick-create modal real company types, contact activity log + marketing badge, per-record page titles, CSV import v2 (address fields, company link, dupe skip, geocode)
- [ ] D — Deals: stage-event history (0029) + expected close + stuck badges, surfaced errors, dedupe message + agency scope, un-complete reactivates requirement + confirm on closing stages, pipeline filter by lead/collaborator, lead picker in create modal, lead-change notification, SendDealModal + metadata on deal page, listing status auto-update from stage, await logDealShare

## Phase 2 (parallel, after Phase 1)
- [ ] B — Listings: search escape, status tile catch-all, source label fixes, quick status popover, relax contact for scraped rows, PDF raw-override + areas fallback, photo upload + gallery + PDF hero, bulk select (status/assign), "Lease & statutory" section, intel resync upsert + geocode + withdrawn-marking, listing page titles
- [ ] E — Comms/Tasks: tasks table + UI (0028), message link allowlist, threading + reply (0030), sidebar unread badge, realtime bell, reminder toggle intent + lead notify + "mine" filter + overdue styling, cron route firing due reminders/tasks (vercel.json)

## Phase 3 (parallel, after Phase 2)
- [ ] C — Matching: wire dormant matches table + new-listing alerts, county-centroid proximity, word-boundary text match, requirement detail shows districts/counties, active-only on listing detail, requirement-agent notifications + error surfacing, requirement page titles
- [ ] F — Intake/Sends: pending-review triage (0031) + approve/reject, ilike escaping, env-var emails, Resend email on submission, public form location combobox, external_sends deal_id + Resend webhook tracking (0032), wizard email-less contact filter, send-history cap fix

## Phase 4
- [ ] G — Dashboard/Reports: KPI fix (exclude closed), activity feed, my tasks/overdue tile, unread tile, /reports for admin+manager (funnel, time-in-stage, per-agent, aging), activity timeline actor names everywhere

## Phase 5 (me)
- [x] Integration: wired refreshMatchesForListing into disposals create/update/status + bulk + intel resync; swapped the matches page onto the targeted getPairSendHistory (killed the limit(500) cap); passed dealId to SendDealModal on the deal page; moved Date.now out of render into lib/time daysSince (react-hooks/purity)
- [x] tsc CLEAN · eslint CLEAN (--max-warnings=0) · `next build` GREEN (new routes: /tasks, /intake, /reports, /api/cron/due, /api/webhooks/resend)
- [x] Migrations 0028–0032 APPLIED to live slc-crm (akxortffkrknoxysgeei); all made idempotent (if not exists + duplicate_object guards) before applying; security advisors show no new findings
- [x] database.types.ts REGENERATED from the live schema — caught a real mismatch: intake_submissions company_name/first_name/email are nullable, so approveSubmission now guards and the card renders gracefully
- [x] Committed 1661ea6 + pushed to main; Vercel deployed
- [x] Live verified on prod: dashboard KPIs scoped ("open deals only", "excludes completed & fell through") + Won tile + My-work strip + activity feed with actor names; /reports funnel + time-in-stage + win rate; /matches Shortlist/Reject + "Deal created" badge; /tasks + /intake render; matches table now being written (6 suggested rows post-deploy)

## Review
Shipped every finding from docs/employee-flow-test-2026-07-22.md except the money model (fees/invoicing), which the user explicitly deferred.

P0s fixed: dashboard counted closed deals as open pipeline; intel resync delete+reinsert severed deals/send-history (now upserts on source_ref, marks missing Withdrawn, geocodes); a comma broke list-page search; un-completing a deal never reactivated its requirement (now does, and closing stages confirm first); public intake created live records with wildcard-mergeable ilike (now a pending triage queue at /intake with escaped lookups + env-var owners); message links were unvalidated (allowlisted); PDFs showed stale scraped rents after edits; deal action errors were swallowed by redirects.

New capability: tasks with assignees/due dates + a 15-min cron that actually fires due reminders and tasks (the system previously never fired anything); persisted matches with proactive bell alerts on listing/requirement change plus shortlist/reject; /reports gated to admin+manager (funnel, time-in-stage, per-agent, aging) which finally gives the manager role meaning; listing photos, quick status popover, bulk status/assign, lease & statutory fields, message threading + Sent view, contact activity log, duplicate warnings, CSV import v2, Resend delivery tracking.

KNOWN FOLLOW-UPS (not blockers):
- Env vars to set in Vercel: CRON_SECRET (required for /api/cron/due to run — returns 503 until set), RESEND_WEBHOOK_SECRET (webhook unverified until set), optional INTAKE_DEFAULT_AGENT_EMAIL / INTAKE_ADMIN_EMAIL (fallbacks preserve current behaviour).
- Match rejection is agency-wide, not per-user (the matches table has no per-user column) — per-user dismissal would need a new table.
- Requirement detail's own match list has no shortlist/reject UI (scoped to /matches).
- County proximity is a centroid+bonus approximation; true border distance needs polygon data.
- Browser-pane clicks landed at (0,0) during verification (pane not compositing), so Shortlist/Reject were verified by DB state + rendered markup rather than a live click.

## Post-batch audit (adversarial re-check of P1/P2/quick-fixes) → commit dd90949
An audit agent re-verified every P1 (9–22), P2 and quick-fix (1–18) item against the tree rather than trusting the build reports. All 18 quick fixes and 20 of 22 P1 items were genuinely done; SIX gaps were found and have now been closed:
- [x] Activity timeline actor names were DANGLING — the component took an `actorNames` prop but no call site passed it and none selected `created_by`. Wired on company/contact/deal detail from the member list those pages already load. VERIFIED LIVE (activity now reads "qa.verify.silo.2026072201 · 22 Jul 2026").
- [x] Inbox had no delete despite RLS allowing it since 0019 → `deleteMessage` + confirm button on Inbox and Sent rows; also scoped markMessageRead/markNotificationRead to the caller (defence-in-depth).
- [x] Quick-create company modal used hardcoded types in 3 of 4 call sites (disposal-form, requirement-form, send-deal-modal) + a 4th found during integration (requirements-table bulk send) → real `company_types` threaded through all of them.
- [x] Deal dedupe silently discarded the typed title → now renames the existing deal and the notice says so (`?existing=1&renamed=1`).
- [x] Contact detail had no KYC path → link added when the contact has a company (KYC runs against the company).
- [x] Entity pickers rendered every option into a native select → bounded type-ahead combobox (≤50 suggestions, keyboard accessible, identical form contract via hidden input); the four list pages now paginate at 25 with a separate lightweight aggregate query so tiles/heatmaps/facets still describe the WHOLE filtered set.

DELIBERATELY NOT DONE: a DB unique index on contacts.email / companies.name. It would contradict the "Create anyway" override the duplicate warning is designed around, converting a friendly warning into an unbypassable DB error. Checked production: zero duplicate groups on either, so nothing is festering.

RESIDUAL (honest limitations, not closed):
- `getMapLayers()` still pulls every geocoded point for the concentration maps, and /requirements still fetches all companies + contacts to populate the Send Deal picker options (the combobox bounds what RENDERS, not what is fetched). Both are shared-lib reads needing whole lists; worth a follow-up if the book grows large.
- Paginated tables' "select all" now selects the current page only (conventional, but a behaviour change).
- Match rejection remains agency-wide, not per-user.
- Verified: tsc CLEAN · eslint CLEAN · `next build` GREEN · deployed and spot-checked on prod.

## 2026-07-22 - Page-to-page navigation slowness

Root cause: Vercel functions ran in the default iad1 (Washington DC) region while Supabase lives in eu-west-2 (London), so every auth/DB round trip crossed the Atlantic (~80ms each) - and each navigation makes several. On top of that the proxy called auth.getUser() (an Auth-server network round trip) on EVERY request, and the (app) layout called it again.

- [x] vercel.json: pin functions to lhr1 (London) next to Supabase and the UK users - the dominant fix.
- [x] proxy (updateSession): getUser() -> getClaims(): local ES256 JWT verification (JWKS confirmed published for the project), zero network on the hot path; still refreshes expired sessions via setAll cookies.
- [x] (app) layout auth boundary: getUser() -> getClaims() (claims.sub / claims.email) - one less Auth round trip per hard load; equally trustworthy (cryptographic verification).
- [x] .claude/launch.json: added "prod" config (next start -p 3999) for verifying prod builds when another dev server holds the Next 16 dev lock.

Verified: next build GREEN (tsc clean) - sign-up -> Dashboard -> Listings -> Contacts exercised in the browser against the prod build; layout admin flag + notifications queries work off claims.sub; no console errors; RSC nav requests 200.

NOT changed: the ~60 other auth.getUser() call sites in pages/actions - once functions are in-region each costs ~10ms, not worth the churn. Page query waterfalls (e.g. listings agents->detail, dashboard membership->profiles) similarly become negligible in-region.

NOTE: region pin takes effect on the next Vercel deploy.

## 2026-07-27 - Full-form modals, London zones/neighbourhoods, requirement form rework

- [x] 0. `New Company -> Add contact` and `New Contact -> Add company` open the FULL form
      in the modal. Extract `CompanyFormFields` / `ContactFormFields`; `Modal` gains `size`;
      `CreatableSelect` gains `size` + `allowCreate` (blocks modal-in-modal recursion);
      `quickCreate*` accept the full payload (address, geocode, agents, dup override).
- [x] 1. London transport fare zones + neighbourhoods as targetable locations.
      Curated `london-areas.json` (name, borough, zone, districts, centroid) ->
      client-safe options via `scripts/build-london-areas.mjs`; new location kinds
      `neighbourhood` + `zone`; migration adds `target_neighbourhoods` /
      `target_london_zones`; scorer resolves them to text/district/proximity targets.
- [x] 2. Use classes -> Pub, Bar, Nightclub, Hot food takeaway, Cafe, Gym, Leisure,
      Restaurant, Other. Class E / A3 / A4 / A5 removed from the picker; enum values
      added + existing rows backfilled. Matcher now scores `property_type` (the concept)
      as a direct hit and `use_class` (the planning class) as partial credit.
- [x] 3. Fit-out removed from requirements (listings keep `fit_out_state`).
- [x] 4. Tenure -> Freehold / Leasehold only; leasehold now also covers assignments.
- [x] 5. Property types removed (folded into use classes).
- [x] 6. Section headers redesigned - numbered step + plain-English description instead
      of the `-> matches ...` strings.
- [x] 7. Requirement page: checkbox per MatchMaker opportunity + sticky bar to send
      several listings to one contact in a single email.

### Review

Shipped 2026-07-28. `tsc` CLEAN - `eslint` CLEAN - `next build` GREEN - exercised end to end
in the browser against a prod build with a throwaway QA agency.

Migrations 0033 (additive: 2 columns + 6 enum values) and 0034 (backfill) applied to the
live project with the user's go-ahead. Backfill verified: no `E` / `A3` / `A4` / `A5` /
`sui_generis_pub_bar` / `assignment` / `new_letting` values remain.

Key decisions
- London data is ONE curated file (`src/lib/locations/data/london-areas.json`, 218 areas:
  name, borough, fare zone, dominant postcode districts, centroid). Zones are derived from
  it rather than stored separately, so "Zone 1" resolves to the union of its areas'
  districts (a direct hit) plus a 2-mile proximity fallback. Neighbourhoods get a 3-mile
  cap. Both caps exist because the flex slider can otherwise stretch a target 25 miles,
  which is meaningless for Soho.
- A district can sit in two zones (NW1 is in both Zone 1 and Zone 2 sets). Inherent to
  district-level approximation; it errs toward inclusion, which is the right bias here.
- Use class absorbed the old "property types" dimension (15 + 10 -> 20 of a 100-point
  scale). The matcher now trusts a listing's `property_type` (the trading concept) over
  its `use_class` (the planning class): concept hit = full credit, and a listing that
  states a type it doesn't match scores zero rather than partial. Planning class is only a
  fallback, at 0.6, for the ~40% of listings with no `property_type`.
- Leasehold now maps to `new_lease` + `sublease` + `lease_assignment`, so retiring the
  Assignment option loses no matching.
- `property_types` / `fit_out_prefs` columns and data are kept, just unread - `payload()`
  omits them, so saving a brief no longer blanks them.
- Full-form modals avoid recursion by omitting the reciprocal picker rather than nesting
  modals; `idPrefix` keeps modal input ids distinct from the page form's.

Also fixed along the way
- The location picker capped suggestions globally, so 1,448 towns buried everything else -
  now capped per kind (all 9 zones always shown).
- `Alert tone="error"` gets `role="alert"` so form errors are announced.

NOT done (out of scope, flagged)
- The public intake form's "Property type" now maps into `use_classes`; its own field is
  unchanged.
- Screenshots weren't possible - the Browser pane isn't displayed in this session, so the
  page never composites frames. Verified structurally through the DOM instead.

## 2026-07-28 - Use classes app-wide, Intake public link, Admin collapse

- [x] `src/lib/use-classes.ts` is now the single source of truth for the nine trading
      concepts (plus `src/lib/text-match.ts` for the whole-word matcher). The requirement
      form, the /matches filter and the scorer all read it instead of holding copies.
- [x] Companies: "Sector tags" free text -> the use-class picker. Legacy tags the picker
      can't express ("brewery", "landlord") are shown in a note and carried through a
      hidden `sector_tags_extra` field, so a save can't destroy them.
- [x] Listings: "Property type" + "Use class" free-text fields -> one picker.
      `property_type` stores the concept list the matcher reads; `use_class` is derived.
      Checked the parser against every distinct property_type in the live book - all
      round-trip. Rows with only a bare planning class carry it through
      (`use_class_carried`) so an unrelated edit can't cost them their 0.6 match credit.
- [x] Listing form's "+ New company" / "+ New contact" now open the full record forms.
- [x] Intake page shows the public form's absolute URL with copy + open, resolved
      server-side from the request host.
- [x] Admin: Team panel starts collapsed like the rest; "Add agent" only shows when open.

Verified: tsc clean, eslint clean, next build green, exercised against a prod build.
Deployed - prod is serving chunk hashes matching the local build of 1e44e9e.

Gotcha worth remembering (now in lessons.md): exporting a constant from a `"use client"`
module and importing it into a Server Component yields a client *reference*, not the
value. It stringified into the page as a thrown-error stub; tsc and eslint were both
clean, only the rendered page showed it.
