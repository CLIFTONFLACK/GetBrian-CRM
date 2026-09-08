-- 0040: an editable Deep Dive prompt, and follow-up questions kept with the
-- company.
--
-- Two additions:
--
-- 1. agency_settings.deep_dive_prompt — the research brief the model is given.
--    It was hard-coded in src/lib/deep-dive/report.ts, so changing what a Deep
--    Dive asks for meant a deploy. NULL means "use the built-in default", which
--    is why it is nullable rather than defaulted here: the default text lives in
--    code next to the logic that fills in the company's details, and copying it
--    into a column would leave two versions to drift apart. Every existing
--    agency therefore keeps exactly today's behaviour until someone edits it.
--
--    Only the *instructions* are editable. The company's own facts (name,
--    website, address, CRN) are appended by the code, so a bad edit cannot
--    strip out which company is being researched.
--
-- 2. deep_dive_messages — the follow-up Q&A thread. Nothing like it existed;
--    public.messages is internal user-to-user mail with no company link and no
--    notion of an assistant. Threads hang off the company rather than off one
--    report, so the conversation survives re-running the Deep Dive (which
--    inserts a new deep_dive_reports row every time — that table is an
--    append-only audit trail). report_id records which report was on screen at
--    the time, for context, and is nullable so a thread isn't lost if that
--    report row is ever removed.

alter table public.agency_settings
  add column if not exists deep_dive_prompt text;

comment on column public.agency_settings.deep_dive_prompt is
  'Overrides the built-in Deep Dive research brief. NULL = use the default in '
  'src/lib/deep-dive/report.ts. Instructions only — company facts are appended '
  'by the application.';

do $$ begin
  create type public.deep_dive_role as enum ('user', 'assistant');
exception when duplicate_object then null; end $$;

create table if not exists public.deep_dive_messages (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  report_id  uuid references public.deep_dive_reports(id) on delete set null,
  role       public.deep_dive_role not null,
  content    text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The thread is always read in full, oldest first, for one company.
create index if not exists deep_dive_messages_company_idx
  on public.deep_dive_messages(company_id, created_at);
create index if not exists deep_dive_messages_agency_idx
  on public.deep_dive_messages(agency_id);

comment on table public.deep_dive_messages is
  'Follow-up Q&A about a company''s Deep Dive report. One row per turn; the '
  'thread is keyed to the company so it survives re-running the report.';
