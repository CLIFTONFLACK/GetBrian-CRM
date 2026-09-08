# Feature batch — requirements / companies / contacts / matchmaker / deep dive

Date: 2026-09-08. Ten requests from Brian.

The codebase was mapped before planning. Several items are much smaller than they
look because the pattern already exists in the repo; two are larger than they
look because the column they assume does not exist yet.

## What already exists — reuse, do not rebuild

- **`CreatableSelect` / `CompanyCreatableSelect` / `ContactCreatableSelect`**
  (`src/components/creatable-select.tsx:118`, `:358`, `:441`) — a searchable
  single-select bound to the parent form by a hidden input, with a "+ New" modal
  that quick-creates the record, selects it and closes. This is exactly the
  "choose or add new" control several items ask for.
- **The private-document pattern** — client-side upload straight to Vercel Blob
  via a path-scoped, short-lived token (`src/app/api/blob/client-upload/route.ts`),
  a metadata row (`disposal_documents`), and an HMAC-signed 1-hour proxy link
  (`src/lib/disposal-docs.ts`, `src/app/api/disposal-docs/[id]/route.ts`).
- **Multi-recipient checkbox lists** — `src/components/send-deal-modal.tsx:276-294`
  (internal recipients), `use-class-checkboxes.tsx`, `agent-fields.tsx`.
- **`createExternalSends`** (`src/lib/db/queries/deals.ts:654`) already takes an
  array of rows.
- **`Modal`** (`src/components/ui/modal.tsx`) — the only dialog primitive; hand
  rolled, no Radix. `compose-message.tsx` is the best modal-with-form template.

Note there is **no zod in this repo** — validation is hand-rolled `FormData`
coercion. Match that style rather than introducing a schema library.

---

## Requirements

### R1 — Link to contact and company; one or the other mandatory, not both

This is a **loosening**, not an addition. Both links already exist on the table
(`requirements.company_id`, `requirements.contact_id`,
`db/migrations/0001_init.sql:183-184`, both nullable) and the form already
renders both pickers (`src/components/requirement-form.tsx:84-89` company,
`:100-108` contact).

What is wrong today is the validation — a contact is currently **compulsory**:

- `src/lib/actions/requirements.ts:148-149` (create) and `:187-189` (update):
  `"A contact is required for every requirement."`
- `requirement-form.tsx:103` marks the contact picker `required`.
- Company is not validated at all.

Change:

- Drop `required` from the contact picker and drop both `contactId` guards.
- Add a single guard to create and update:
  `if (!data.companyId && !data.contactId) return { error: "Link this requirement to a company or a contact." }`
- Client side, neither picker gets a bare `required` attribute — that would
  demand both. Validate the pair on submit and show one message beneath them.

**Reading to confirm:** "not both" is taken as *not both mandatory*, not *both
forbidden*. Linking a company and a contact together stays legal — that is the
normal case, and the contact is described in the UI as the operator's point of
contact.

### R2 — Landlord pack upload

No "landlord pack" concept exists anywhere in the codebase. Mirror the disposal
documents pattern exactly:

1. **Migration** `requirement_documents` — `(id, agency_id, requirement_id, name,
   doc_type default 'landlord_pack', file_path, size_bytes, uploaded_by,
   created_at)` plus agency and requirement indexes. Same shape as
   `disposal_documents` (`db/migrations/0012_disposal_documents_areas.sql:19-35`).
2. **Token route** — add a `requirement-doc` kind to the `UploadContext` union in
   `src/app/api/blob/client-upload/route.ts:33-36`, path-scoped to
   `${requirementId}/`, with an agency-ownership check on the requirement.
   **This check is the cross-tenant boundary — it must not be skipped.**
3. **Signed proxy** — `src/lib/requirement-docs.ts` and
   `src/app/api/requirement-docs/[id]/route.ts`, copying the HMAC signing, the
   1-hour TTL and the deliberate identical-404-on-every-failure behaviour.
4. **Action + component** — `src/lib/actions/requirement-documents.ts` and a
   `RequirementDocuments` client component modelled on `disposal-documents.tsx`.
   Keep the rule that `file_path` never crosses to the client.
5. **Render** — new `<Card className="mt-4">` on
   `src/app/(app)/requirements/[id]/page.tsx`, inserted after the two-column grid
   closes at line 307 (before the MatchMaker card at 309).

**Open question.** A landlord pack describes a *premises*, so it would normally
live on a listing/disposal, where `disposal_documents` already exists and would
need only a new `doc_type` value — roughly a one-line change instead of a new
table plus two routes. Building it on the requirement as literally asked unless
told otherwise.

### R3 — Tenure default to Leasehold

`requirements.tenure_prefs` is an **array of preferences**
(`public.tenure_type[]`, not null, default `'{}'`,
`db/migrations/0001_init.sql:195`) — a checkbox group, not a select. It renders
via `CheckboxGroup` at `requirement-form.tsx:159-164`, with only two live options
(`TENURES`, `:27-31` — Freehold and Leasehold; `db/migrations/0035` collapsed
assignment and new_letting into leasehold). Nothing is pre-checked today.

Change: pre-check Leasehold **on a new requirement only**. An existing
requirement keeps whatever was saved, including a deliberately empty set.

Do **not** change the column default. That would silently rewrite the meaning of
"no preference" for every other writer — the public intake form and the importer
both insert requirements.

---

## Companies

### C1 — Contact becomes mandatory

Today the contact picker is optional **and only renders on create**
(`src/components/company-form-fields.tsx:162` —
`{!company && contactPicker ? contactPicker : null}`), and `createCompany`
validates only the name (`src/lib/actions/companies.ts:105-106`). The picker
posts under `link_contact` and is handled conditionally at `companies.ts:127-132`;
`updateCompany` never reads it.

Change: add `required` to the picker and a matching server guard in
`createCompany`.

**Open question — legacy rows.** Because the picker is absent on the edit form,
every company created before this change has no enforced contact and cannot be
given one from the edit page. Two options:

- **(a) Create-only enforcement, edit untouched.** Least disruptive; old rows
  stay non-compliant. *Recommended.*
- **(b) Also render the picker on edit and enforce there.** Creates backfill
  pressure — it blocks saving any edit to a legacy company until a contact is
  added.

### C2 — Add requirements from a company (not mandatory)

The company page already has a Requirements card with an "Add requirement" link
(`src/app/(app)/companies/[id]/page.tsx:302-340`), and
`/requirements/new?company={id}` already pre-selects the company
(`requirement-form.tsx:87`, via `defaultCompanyId`). The navigation path exists.

Reading this as "add one without leaving the page": add a `+ New requirement`
modal on the company page using the existing `Modal`, posting a quick-create
(title + status, company inherited). Needs a `quickCreateRequirement` action
returning `state.created`, mirroring `quickCreateContact`
(`src/lib/actions/contacts.ts`).

### C3 — KYC section to match the Deep Dive section

Measured difference, both on `src/app/(app)/companies/[id]/page.tsx`:

| | placement | variant | size | extras |
|---|---|---|---|---|
| **KYC** (`:236-244`) | CardHeader, right-aligned | `secondary` | `sm` | — |
| **Deep Dive** (`:290-300` + `deep-dive-view.tsx:41-58`) | card **body** | `default` | default | `<Sparkles/>` icon, `CardDescription` |

The request is to make KYC match Deep Dive. Worth flagging before doing it: the
header/`secondary`/`sm` form KYC uses today is the convention **every other card
on the page follows** — Contacts (`:192-201`), Requirements (`:303-311`),
Listings (`:343-352`). Moving KYC to Deep Dive's style makes the page *less*
internally consistent, and Deep Dive is the single outlier.

**Open question:** match KYC to Deep Dive as asked, or match Deep Dive to the
page convention (recommended)?

---

## Contacts

### CT1 — Primary contact

**There is no primary-contact concept in the schema.** Grepping
`primary_contact|is_primary` across `db/migrations/*.sql` returns nothing — the
only "primary" tokens are `primary key`. The company↔contact link is just
`contacts.company_id` (`db/migrations/0001_init.sql:112`); many contacts, no
designated head. This is the largest hidden item in the batch.

- **Migration:** `contacts.is_primary boolean not null default false`, plus a
  partial unique index on `(company_id) where is_primary` so a company can have
  at most one.
- **Backfill:** nothing is promoted automatically. Companies with several
  contacts simply have no primary until one is set. (Auto-promoting the oldest
  contact is possible but guesses at business meaning — say if you want it.)
- **UI:** a "Primary contact" toggle on the contact form; a Primary badge in the
  company page's Contacts card.
- **Consumers:** send flows default their recipient to the company's primary
  contact, falling back to current behaviour when none is set.

### CT2 — Choose or add a requirement from a contact

There is currently **no requirements UI on the contact page at all** —
`src/app/(app)/contacts/[id]/page.tsx` renders only Details, Location and
Activity, and `listRequirementsFor*` is not even imported. No
`listRequirementsForContact` query exists: `requirements.contact_id` is written
(`src/lib/db/queries/requirements.ts:302`, `:347-348`) but never used as a
filter. The linkage is one-way today.

- Add `listRequirementsForContact(agencyId, contactId)` to
  `src/lib/db/queries/requirements.ts`, mirroring `listRequirementsForCompany`
  (`:194-205`).
- Add a Requirements card to the contact page using the standard
  header/`secondary`/`sm` action, linking to `/requirements/new?contact={id}`,
  plus the quick-create modal from C2.
- `requirement-form.tsx` needs a `defaultContactId` to match its existing
  `defaultCompanyId`, and the new-requirement page must read `?contact=`.

---

## Matchmaker

### M1 — Send to multiple contacts

The plural machinery already exists: listings, requirements and the
`external_sends` fan-out are all arrays. Only the recipient is singular. Five
chokepoints:

- `src/lib/actions/deal-send.ts:69` — reads a single `contact_id`
- `:100` — `getContactById`
- `:184` — `to: contact.email` (a scalar)
- `src/lib/db/queries/deals.ts:644` — `contactId: string` in `ExternalSendInput`
- `src/components/send-deal-modal.tsx:392-410` — single-value picker

Change:

- Swap the picker for a checkbox list of email-bearing contacts — the pattern at
  `send-deal-modal.tsx:276-294` already does exactly this for internal
  recipients — posting repeated `contact_ids`, with the CT1 primary pre-ticked.
- Resolve every id and reject any without an email **before** sending anything.
- Fan-out becomes recipient × requirement × listing in `createExternalSends`.
  **No schema change needed.**

**Privacy decision — needs a call.** Putting several addresses in Resend's `to:`
means **every recipient sees the others**. Sending one deal to competing
operators would disclose the distribution list to all of them.

Recommendation: **one separate email per recipient** — a loop of N sends, each
with its own `provider_id`, so the Resend engagement webhook
(`src/app/api/webhooks/resend/route.ts`, which correlates solely on
`provider_id`) keeps tracking opens and clicks per recipient.

Resend's `batch.send` would be cheaper but **does not support attachments**, and
every send here carries particulars PDFs (`deal-send.ts:108-117`), so the loop is
the only option that preserves them. Partial failure needs a defined outcome:
report which recipients succeeded rather than failing the whole action.

---

## Deep Dive

### D1 — Switch on

Deep Dive is **not** code-disabled. There is no env var, no feature flag and no
stub. It is off purely because no key is stored:

- `src/lib/openrouter/config.ts:22` — `if (!settings?.openrouter_api_key) return null;`
- `src/lib/actions/deep-dive.ts:26-29` — returns *"Add an OpenRouter API key in
  Admin to enable Deep Dive."*

Switching on = pasting a key into **Admin → "AI — Company Deep Dive"**
(`src/components/admin-panel.tsx:772`), which writes
`agency_settings.openrouter_api_key` (`db/migrations/0019_agency_settings.sql:19`).
**No deploy required.** The key is never read from `process.env` and never
belongs in the repo.

Three blockers before it will actually work:

1. **The pasted key is compromised.** It was sent in plain chat, so it must be
   rotated at openrouter.ai/keys before use. It goes into the Admin form, not
   into code.
2. **A free model cannot do this job as designed.** All four models in the
   dropdown (`admin-panel.tsx:803-808`) are **web-search** models, because the
   report is *live research* — the prompt asks for recent news, financials and
   competitors over the last 12–24 months
   (`src/lib/deep-dive/report.ts:32-38`). A free OpenRouter model has no web
   access, so it will produce confident, unsourced guesswork about real
   businesses that an agent may act on commercially — while the system prompt
   promises "never invent figures. Cite sources inline." The `:online` suffix
   adds web search to any model but is charged per result, so "free with web
   search" is not available.
   **Needs a call:** add free models to the dropdown anyway and accept the
   quality drop, or keep a search model.
3. **The 10-second timeout will abort most runs.** `src/lib/openrouter/client.ts:36`
   sets `AbortSignal.timeout(10_000)` while the UI tells the user it *"can take
   up to a minute"* (`src/components/deep-dive-view.tsx:62`) — already
   inconsistent today, and free-tier models queue far longer. Raise the client
   timeout and set `maxDuration` on the route; nothing sets one anywhere and
   `vercel.json` has no function config.

### D2 — Edit prompt, and ask follow-up questions

The prompt is hardcoded in one place: `src/lib/deep-dive/report.ts:14-19`
(`const SYSTEM`) and `:21-43` (`userPrompt()`, which builds the company facts
plus a fixed 7-section outline).

**Edit prompt**

- Add `deep_dive_prompt text` to `agency_settings` (nullable — the current text
  stays the fallback, so behaviour is unchanged until someone edits it).
- Edit UI in the Admin AI card, with a "Reset to default" action.
- Company facts stay appended by code rather than living in the editable text,
  so a bad edit cannot strip the company being researched.

**Ask questions after the report**

- New table `deep_dive_messages` — `(id, agency_id, company_id, report_id, role,
  content, created_at, created_by)`. Nothing like it exists; `public.messages`
  (`db/migrations/0020_internal_messages.sql`) is internal user-to-user mail with
  no company link and no AI role concept. Threads are keyed per company, so they
  persist on the company profile as asked.
- Q&A modal on the company page using the existing `Modal`, seeded with the
  report markdown as context.
- `openRouterChat` (`src/lib/openrouter/client.ts:8`) takes a single
  system + user pair and hardcodes a 2-message array (`:31-34`). It needs to
  accept a message array for a real conversation.
- **No streaming exists anywhere in the repo** (no `ReadableStream`,
  `EventSource`, `text/event-stream` — zero matches in `src/`). Answers arrive
  in one blocking response like the report does; a streaming transcript would be
  greenfield.
- **Cost note:** every follow-up re-sends the report as context, so a long thread
  costs materially more than the one-shot report.

---

## Sequencing

Three migrations (`requirement_documents`; `contacts.is_primary`;
`deep_dive_messages` + `agency_settings.deep_dive_prompt`) and roughly 25 touched
files. Suggested order, each step independently shippable:

1. **Quick wins, no migration** — R1, R3, C1, C3, and D1's config/timeout fixes.
2. **Primary contact** — CT1 migration and UI. M1 depends on it.
3. **Multi-recipient send** — M1.
4. **Requirement documents** — R2. Self-contained: new table, two routes.
5. **Requirements from company and contact** — C2 and CT2, sharing one
   quick-create action.
6. **Deep Dive prompt and Q&A** — D2. Largest: new table, client refactor.

## Decisions (confirmed by Brian, 2026-09-08)

1. **R1** — at least one of company/contact required; linking **both stays
   allowed**. Only "neither set" is blocked.
2. **R2** — landlord pack lives on **requirements**, as asked. New
   `requirement_documents` table plus the two routes.
3. **C1** — mandatory contact enforced on **create *and* edit**. The contact
   picker gets added to the company edit form, which currently has none. This
   forces a backfill: a legacy company cannot be saved until it has a contact.
   Accepted deliberately.
4. **C3** — **KYC moves to Deep Dive's style** (card body, default variant, full
   size), as asked. Deep Dive stays as it is. Noted that this leaves KYC and Deep
   Dive differing from the header/secondary/sm form used by Contacts,
   Requirements and Listings on the same page.
5. **M1** — **one shared `to:`**: a single email with every recipient visible to
   the others. Chosen with the disclosure trade-off understood. One `provider_id`,
   so engagement tracking is per-send rather than per-recipient.
6. **D1** — stay on **`perplexity/sonar`** (~0.5p per report at this prompt
   size: $1/M in, $1/M out, $5/1K web-search calls). No free models added. Key to
   be rotated and pasted into Admin by Brian.

## Added scope — bulk CSV/XLS import (requested mid-session)

Brian: "ensure they also work for bulk uploads via csv/xls. also check records are
not duplicated but updated if it exists in the system and also on an upload file".

### What the importer does today

Entry: Admin → "Import data" (`src/components/data-import.tsx`), four entities —
companies, contacts, requirements, listings. Parsing is client-side (SheetJS,
first sheet only); the CSV text is POSTed as a hidden field to
`importEntityCsv` (`src/lib/actions/import-data.ts`), which writes through the
**DAO layer directly and bypasses every form Server Action** — so no validation,
duplicate policy or side-effect that lives in an action applies to an upload.

Duplicate handling as found:

| entity | existing record | same file | on re-upload |
|---|---|---|---|
| companies | name match → **skip** | yes | skipped, never updated |
| contacts | email match → **skip** | email rows only | **no email ⇒ no check at all** |
| requirements | **none** | **none** | duplicates every row |
| listings | **none** | **none** | duplicates every row |

There are **no unique indexes** on companies, contacts or requirements
(`db/migrations` has five `unique` clauses in total, none of them these), so the
dedupe is application-only: the lookup maps are read once before the inserts, and
two concurrent imports both act on a stale view. `disposals` does have
`unique (agency_id, source, source_ref)`, but the CSV path leaves `source_ref`
NULL and NULLs never conflict, so it is inert.

### Decisions (confirmed by Brian)

7. **Match keys** — company: Companies House number when present, else name.
   Contact: email when present, else first + last name within the same company.
   Exact matching, no fuzzy normalisation.
8. **Requirements and listings** — a new optional `external_ref` column on both
   templates. Supplied ⇒ re-uploads update that row; blank ⇒ always insert. For
   listings this reuses the existing `(agency_id, source, source_ref)` index.
9. **Blank cells never clear data** — an update writes only the columns actually
   present and non-empty in the file, so a partial upload tops records up
   instead of wiping notes, agents or addresses.
10. **Verification** — Brian checks the screens; the app is behind auth and no
    stray account gets created in the live database.

### Work this implies

- Real unique indexes to back the keys, so concurrent imports can't both insert:
  partial unique on `companies (agency_id, lower(company_number))` where present,
  `companies (agency_id, lower(name))`, `contacts (agency_id, lower(email))`
  where present. Each needs a de-duplication pass over existing rows first —
  **the index will fail to create if the table already holds duplicates**, so the
  migration has to report them rather than silently merge.
- `external_ref` on `requirements`; listings reuse `source_ref`.
- Upsert helpers in the DAO taking a partial patch (blank-preserving), used by
  the importer for all four entities.
- In-file dedupe extended to requirements and listings, and to contacts with no
  email.
- The new requirement rule (company **or** contact) applied to the importer,
  which today demands a contact and always sets `company_id` to null — so a CSV
  still cannot create a company-only brief until this changes.
- **Not asked for, worth raising:** `importEntityCsv` performs no admin check.
  Only the admin *page* is gated, and a Server Action is directly POST-reachable,
  so any signed-in agency member can import.

## Review

### Delivered

| # | Item | Status |
|---|---|---|
| R1 | Requirement links to company and/or contact; at least one required | Done |
| R2 | Landlord pack upload on requirements | Done |
| R3 | Tenure defaults to Leasehold on new requirements | Done |
| C1 | Company contact mandatory, on create and edit | Done |
| C2 | Add requirements from a company | Already existed; contact-side equivalent added |
| C3 | KYC section restyled to match Deep Dive | Done |
| CT1 | Primary contact | Done |
| CT2 | Choose/add a requirement from a contact | Done |
| M1 | Send to multiple contacts | Done |
| D1 | Deep Dive switched on | Code ready; needs a rotated key pasted into Admin |
| D2 | Editable prompt + follow-up Q&A saved on the company | Done |
| Extra | Bulk CSV/XLS upsert and de-duplication | Done |

### Migrations added (apply in order; the runner does all files in one pass)

- `0036_import_external_ref.sql` — `requirements.external_ref` + lookup index.
- `0038_primary_contact.sql` — `contacts.is_primary` + one-primary-per-company
  partial unique index.
- `0039_requirement_documents.sql` — the landlord-pack table.
- `0040_deep_dive_prompt_and_chat.sql` — `agency_settings.deep_dive_prompt`,
  `deep_dive_messages`, `deep_dive_role` enum.
- `0041_import_dedupe_uniques.sql` — the unique indexes behind the import match
  keys. **Numbered last deliberately**: it is the only migration that can
  legitimately fail on live data (a unique index cannot be built over existing
  duplicates), and `scripts/run-migrations.mjs` applies every file in one pass,
  so a halt here must not take the others down with it. It raises with the
  offending values named rather than merging or deleting anything.

### Verification

- `npm run build` green. Note the build **cannot run on the `G:` drive** — the
  Google Drive volume supports no reparse points, so Turbopack fails at
  `failed to create junction point` and the webpack builder at `EINVAL: write`.
  Built from a local mirror at `C:\dev\cdg-crm` (robocopy source across,
  `npm install` there); this matches the existing note in `~/.claude/lessons.md`
  about npm on this volume.
- `npx tsc --noEmit` clean; `npx eslint src` clean apart from one pre-existing
  warning in `src/proxy.ts`.
- `node scripts/verify-import-headers.mjs` — all checks pass, every control red,
  including against CDG's real exports in `Data CSVs/`.
- `node scripts/verify-import-upsert.mjs` — **new**. Exercises the match/merge
  rules directly (CRN-beats-name, in-file merge keys, blank preservation, the
  contact name fallback, the requirement link rule), each paired with a control
  that must fail.
- Document-token namespacing tested directly: a token minted for a listing
  document does **not** open a requirement document, and vice versa; expired and
  tampered tokens are refused.
- Confirmed the `"use server"` export rule is real by re-adding a synchronous
  export and watching the build reject it — that is why `requirementLinkError`
  lives in `src/lib/requirement-rules.ts` rather than in the actions file.
- Confirmed the Admin prompt editor does **not** drag the database client into
  the browser bundle: the prompt constant appears in the client chunks (it must),
  no `neondatabase` / `STORAGE_CRM_DATABASE_URL` marker does. That is why the
  constants live in `src/lib/deep-dive/prompt.ts`.

### NOT verified — be aware

- **No screen was looked at.** The app redirects to `/login` and no throwaway
  account was created in the live database, so every UI change is unexercised in
  a browser. Brian is checking the screens.
- **The four import UPDATE statements never ran.** There is no local Postgres or
  Docker in this environment, so the blank-preserving `coalesce($value, column)`
  behaviour is reasoned-about, not executed. First real upload should be a small
  file against records whose values are known.
- **No migration has been applied**; they are written, not run.
- **Deep Dive has never been called.** No OpenRouter key is stored, so the
  report path, the new 90s timeout and the Q&A thread are all untested against
  the real API.

### Follow-ups worth raising

- `importEntityCsv` performs **no admin check**. Only the admin *page* is gated
  (`isAgencyAdmin`), and a Server Action is directly POST-reachable, so any
  signed-in agency member can run a bulk import. Pre-existing, not introduced
  here, but it now also carries update power rather than insert-only — which
  makes it worth more than it was.
- `quickCreateCompany` (the "+ New company" modal used inside other forms) is
  exempt from C1's mandatory-contact rule, because that modal cannot open a
  nested contact picker. Companies created that way are stubs with no contact.
- The Resend engagement webhook correlates on `provider_id`. With one shared
  email to several recipients there is a single `provider_id`, so
  delivered/opened/clicked now describe the send as a whole rather than each
  recipient. Separate emails per recipient would restore per-recipient tracking.
- `deep_dive_reports.sources` is still never populated by any code path.
- **The 10s OpenRouter timeout was deliberate**, not an oversight: it came from
  `docs/audit-handover-2026-07-02.md` S1, a blanket
  `AbortSignal.timeout(10_000)` added to all six external fetches so a hung
  third party couldn't hang a request until a platform 504. Raising it to 90s
  keeps that guarantee — 90s aborts below the route's 120s `maxDuration`, so a
  stalled model still fails with our own labelled error. Only the blanket figure
  changed. **Worth confirming:** `maxDuration = 120` assumes a Vercel plan above
  Hobby (which caps Node functions at 60s). The admin page has used 120 for a
  while, which is the evidence it works — not proof. On Hobby, both that page
  and Deep Dive would hit the very 504 S1 was guarding against.
