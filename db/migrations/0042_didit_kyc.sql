-- 0042: Didit identity verification (KYC) — a paid, per-person check,
-- configured per agency.
--
-- Two additions:
--
-- 1. agency_settings.didit_api_key / didit_workflow_id — the Didit credentials,
--    entered on the Admin page exactly like the OpenRouter key above them
--    (0019_agency_settings.sql). Per-agency rather than in a DIDIT_API_KEY env
--    var because Didit bills each session to whichever account started it. The
--    env vars stay supported as a fallback for a single-tenant deployment
--    (src/lib/kyc/config.ts).
--
--    A workflow id is required as well as a key: Didit takes the check type
--    from the workflow, not from a flag on the request, so without one there is
--    nothing to point a check at. The Admin page lists the account's workflows
--    and only offers those with workflow_type = "kyc".
--
-- 2. didit_sessions — one row per identity check started for a CONTACT.
--
--    A Didit KYC session verifies a *person*: document OCR, liveness, face
--    match and (on an AML-enabled workflow) a watchlist screen of that person's
--    name. So the row hangs off contacts, not companies. company_id is carried
--    alongside — denormalised from the contact at the time the check was
--    started — so the KYC page and the company report can show "who at this
--    company has been verified" without a join through a contact that may since
--    have been moved or deleted.
--
--    This is NOT part of kyc_reports, and deliberately so. A kyc_reports row is
--    a finished snapshot assembled synchronously from free sources; a Didit
--    session is long-lived (it sits AWAITING_USER until the person completes it
--    on their phone) and its decision is fetched repeatedly over that life.
--    Keeping them apart means generating a KYC report stays free and
--    synchronous: it folds in whatever decisions have already landed here, and
--    never makes a paid call of its own.
--
--    decision holds the raw payload from GET /v3/session/{id}/decision/, so a
--    later mapping change can be re-derived without paying for the check twice.

alter table public.agency_settings
  add column if not exists didit_api_key text;
alter table public.agency_settings
  add column if not exists didit_workflow_id text;

comment on column public.agency_settings.didit_api_key is
  'Didit API key (x-api-key). Server-only; never sent to the browser — the Admin form is write-only and shows a "saved" placeholder instead.';
comment on column public.agency_settings.didit_workflow_id is
  'Didit workflow uuid of workflow_type = "kyc". Required: the workflow is what makes a session an identity check.';

create table if not exists public.didit_sessions (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  contact_id    uuid not null references public.contacts(id) on delete cascade,
  -- The contact's company when the check was started. Nullable: a contact need
  -- not belong to one.
  company_id    uuid references public.companies(id) on delete set null,
  -- Didit's own identifiers. session_id is unique so a refresh can never fan
  -- out into duplicate rows for one session.
  session_id    text not null unique,
  workflow_id   text,
  session_url   text,
  -- Didit's status vocabulary, stored verbatim: NOT_STARTED, IN_PROGRESS,
  -- AWAITING_USER, IN_REVIEW, APPROVED, DECLINED, EXPIRED, ABANDONED. Text
  -- rather than an enum because it is Didit's list to change, not ours.
  status        text not null default 'NOT_STARTED',
  -- Raw GET /decision/ payload, refreshed in place.
  decision      jsonb,
  -- Denormalised headlines so list views don't have to open the jsonb.
  aml_hits      integer not null default 0,
  -- The name Didit read off the document, which is the point of the check: it
  -- is evidence about the person, independent of what the CRM has typed in.
  verified_name text,
  error         text,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists didit_sessions_contact_idx
  on public.didit_sessions (agency_id, contact_id, created_at desc);
create index if not exists didit_sessions_company_idx
  on public.didit_sessions (agency_id, company_id, created_at desc);

drop trigger if exists trg_didit_sessions_updated on public.didit_sessions;
create trigger trg_didit_sessions_updated before update on public.didit_sessions
  for each row execute function public.set_updated_at();
