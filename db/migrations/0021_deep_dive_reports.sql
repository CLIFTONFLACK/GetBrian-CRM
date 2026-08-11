-- Phase 5 — AI "Deep Dive" company research reports
-- One row per Deep Dive run (audit trail), mirroring kyc_reports. The synthesised
-- research is stored as `markdown` (rendered on the company page + exported to
-- PDF).
--
-- ADAPTED FROM SUPABASE: Row-Level Security dropped; created_by now references
-- public.users(id).

do $$ begin
  create type public.deep_dive_status as enum ('pending', 'complete', 'failed');
exception when duplicate_object then null; end $$;

create table public.deep_dive_reports (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  status      public.deep_dive_status not null default 'pending',
  model       text,
  markdown    text,
  sources     text[] not null default '{}',
  error       text,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index deep_dive_company_idx on public.deep_dive_reports(company_id, created_at desc);

create trigger trg_deep_dive_updated before update on public.deep_dive_reports
  for each row execute function public.set_updated_at();
