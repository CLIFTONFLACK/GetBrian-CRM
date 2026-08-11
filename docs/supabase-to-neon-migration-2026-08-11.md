# Handover: Supabase → Neon/Blob/Upstash migration (2026-08-11)

## Why

The Supabase project backing this CRM (`akxortffkrknoxysgeei`) was accidentally
deleted during a housekeeping cleanup ~11 days before this work started,
taking production down (auth, database, and file storage all dead — confirmed
via NXDOMAIN on the project's hostname and a 404 from Supabase's own API).
Rather than recreate the Supabase project, the owner chose to re-platform
onto Vercel-native storage already available on the team's Vercel Pro plan.

It turned out the data loss didn't matter — the Supabase project only ever
held demo/test data.

## What it runs on now

| Concern | Before | After |
|---|---|---|
| Database | Supabase Postgres + RLS | Neon Postgres, raw SQL (`@neondatabase/serverless`), no ORM |
| Auth | Supabase Auth (JWT, `getClaims()`) | Auth.js v5 (`next-auth@beta`), Credentials + bcrypt, JWT sessions |
| Tenant isolation | Postgres RLS policies | App-layer: every DB query takes `agencyId` as a mandatory first parameter, resolved server-side from the session — see "Tenant isolation" below |
| File storage | Supabase Storage (3 buckets) | Vercel Blob, + a custom signed-proxy route for the one private bucket (Blob has no native signed-URL primitive) |
| Rate limiting | none | Upstash Redis (`@upstash/ratelimit`), on `/login` and public `/submit-requirement`, fails open if unconfigured |

**Deployed and verified live** at `crm.getbrian.xyz` (Vercel project `brian-crm`,
team `clifton-ai-team`). Repo moved from `slapharma/SLC-CRM` to
`CLIFTONFLACK/GetBrian-CRM`.

## Sequencing (for context on where things live)

Work landed in ordered batches (each independently verified against the live
database before moving on — not just trusted from a subagent's self-report):

0. Repo mirrored to the new GitHub remote; Vercel's Git integration repointed.
1. Neon, Blob, and Upstash provisioned via Vercel's Storage tab.
2. **`db/migrations/`** — 35 original Supabase migrations adapted down to 28:
   `auth.*`/RLS/`SECURITY DEFINER`/storage-policy content stripped; `profiles`
   merged into a plain `public.users` table (see `0001_init.sql`'s header).
   Applied clean to the live Neon database.
3. **`src/lib/auth/`**, **`src/lib/db/client.ts`** — Auth.js config + bcrypt
   module + the Neon query client (`sql` tagged template, `isDbConfigured`
   flag mirroring the old `isSupabaseConfigured` pattern).
4. **`src/lib/db/queries/`** — the DAO layer, one file per domain
   (companies, contacts, disposals, requirements, deals, matches, activities,
   messages, admin, kyc, deep-dive, intel, intake, tasks, dashboard, agencies).
   All 87 original Supabase call sites across the app were rewritten onto
   this layer.
5. File storage moved to Vercel Blob. `src/lib/disposal-docs.ts` +
   `src/app/api/disposal-docs/[id]/route.ts` replace Supabase's private-bucket
   signed URLs with an HMAC-signed proxy (`DOC_SIGNING_SECRET`) — the
   signature is bound to the document id, so redemption doesn't need a second
   agency check; the *signing* step is the authorization check, mirroring how
   Supabase's own signed URLs worked.
6. Demo/seed data ported (`supabase/seeds/*.sql`, `scripts/load-cdg-listings.ts`)
   and loaded into the live Neon database.
7. **`src/lib/rate-limit.ts`** — Upstash rate limiting wired into `signIn` and
   `submitPublicRequirement`.
8. `src/lib/supabase/` deleted entirely (zero references left app-wide);
   `@supabase/ssr`/`@supabase/supabase-js` removed from `package.json`.
9. Committed to a branch, pushed (→ Vercel preview), verified, merged to
   `main` (→ production), verified live through the actual browser.

## Tenant isolation — read this before adding a new query

There is **no RLS backstop on this schema.** Every DAO function in
`src/lib/db/queries/` takes `agencyId: string` as a mandatory first
parameter and filters on it explicitly — that filter **is** the entire
tenant boundary now. `agencyId` must always be resolved server-side via
`currentAgencyId(userId)` (`src/lib/db/queries/agencies.ts`), called after
`auth()` — never accepted from client input, a form field, or a URL param.

The one deliberately unscoped exception:
`getDisposalDocumentByIdUnsafe` (`src/lib/db/queries/disposals.ts`) — safe
only because its one legitimate caller (`/api/disposal-docs/[id]`'s
signed-token path) already proved authorization at sign time. Don't call it
from anywhere else.

## Known gotcha worth knowing about

`@neondatabase/serverless`'s driver only parses **well-known** Postgres array
types (`text[]`, `uuid[]`, etc.) into real JS arrays. An array of a **custom
enum type** (e.g. `use_class[]`, `tenure_type[]`) comes back as the raw
literal string `"{E}"` instead of `["E"]`. This bit us once already —
`requirements.use_classes`/`tenure_prefs` crashed the MatchMaker scorer in
production (`/matches`, `/requirements/[id]`, `/listings/[id]`) with
`TypeError: a.some is not a function` until fixed by casting to `::text[]`
in every affected `SELECT` (`src/lib/db/queries/requirements.ts`). If a
future migration adds another enum-array column, cast it the same way.

Similarly: `timestamptz` columns come back as JS `Date`, which is
millisecond-precision — lossy against Postgres's microsecond storage. Any
column read for a later `where updated_at = ...` optimistic-concurrency
check is cast `::text` in the `SELECT` (see `companies.ts`'s
`getCompanyForUpdate` for the pattern) so the round-trip stays exact.

## Environment variables

**Removed**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`.

**Added** (all in `.env.example`; real values in `.env.local` and Vercel
project settings — see gotcha below):
- `STORAGE_CRM_DATABASE_URL` — Neon connection string. Named `STORAGE_CRM_*`
  because that's the actual resource name Vercel's Storage tab assigned it,
  not a renaming choice.
- `AUTH_SECRET` — Auth.js session signing secret.
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob.
- `DOC_SIGNING_SECRET` — HMAC secret for the disposal-docs signed proxy.
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — Upstash Redis via Vercel's KV
  wrapper (not the raw `UPSTASH_REDIS_REST_*` names — Vercel's own naming).
- `CRON_SECRET` — bearer secret for `/api/cron/due`. This one **predates**
  this migration and was already missing in Vercel before this work started
  (the route already had the bearer-check code); not something this
  migration broke, just something that got noticed and fixed along the way.

**Vercel-environment-scoping gotcha, hit twice during this rollout**: adding
an env var to a Vercel project does **not** retroactively apply to an
already-built deployment, and each var is scoped per-environment
(Production / Preview / Development independently). `AUTH_SECRET` was added
scoped to Preview only at first, which silently broke Production with
`MissingSecret` until a second var-add + redeploy. If you add a new secret,
scope it to every environment you intend to use, and trigger a fresh
deployment (`git commit --allow-empty` + push is the fastest way) — don't
assume it's live just because the dashboard shows it saved.

## Verification performed

Every batch was checked against the **live** Neon database directly (not
just `tsc`/`build`), including cross-agency isolation (agency A cannot read
or write agency B's rows — checked as an explicit negative case, not
assumed), optimistic-concurrency rejection of stale writes, and — for the
admin/auth batch — that a non-admin is actually rejected performing admin
actions. After production cutover, the actual browser flow was exercised
live: login, dashboard KPIs, companies list, and (post-fix) MatchMaker, all
confirmed rendering real seeded data with zero unexpected runtime errors.

Seed data confirmed live in the database: 2 agencies, 9 users, 50 companies,
75 contacts, 20 requirements, 87 disposals. Demo login:
`morris@cdgleisure.com` / `Demo!2026` (password was reset once during this
session after a stale password from an earlier manual test — see git log
around 2026-08-11 if the credential ever needs tracing).

## Follow-ups / not done in this session

- **`mobile/phone-nav-and-touch-targets`** — the branch this session started
  on, with its own unrelated uncommitted work (iOS sign-in zoom fix),
  still sitting separately. Not touched by this migration.
- **`supabase/seeds/cdg_listings.sql`, `scripts/gen-cdg-batches.ts`,
  `scripts/generate-cdg-seed.ts`** — still reference the now-nonexistent
  `public.profiles` table. Harmless today (superseded by the rewritten
  `scripts/load-cdg-listings.ts`), but would break if anyone regenerates
  seed data from them directly. Worth a follow-up pass if these scripts get
  used again.
- **RLS as defense-in-depth** — the plan's original design doc floated
  re-adding real Postgres RLS on the highest-risk tables (KYC reports, deals)
  via per-request session variables, as a hardening layer on top of the
  app-layer checks, once the migration itself was stable. Not started.
- **`COMPANIES_HOUSE_API_KEY`** — still unset (pre-existing, unrelated to
  this migration); KYC reports run without company/officer/PSC data until
  it's added.
- One incident worth knowing about: an early migration batch left a
  throwaway script with a hardcoded real-looking password in it, caught and
  deleted during review — flagged to the owner at the time. No such script
  should exist in the repo now, but worth a `git log -p` grep if anything
  seems off.

## Rollback

`crm.getbrian.xyz` stayed on the same Vercel project throughout (only Git
source and env vars changed, no DNS change), so the prior Supabase-backed
production deployment is still available in Vercel's deployment list as an
instant rollback target if something is found to be seriously wrong —
though rolling back would mean losing everything built in this session,
including the now-fixed Supabase outage itself.
