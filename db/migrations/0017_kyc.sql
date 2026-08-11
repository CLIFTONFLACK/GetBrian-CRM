-- Phase 3 — UK company KYC / KYB
-- (1) Adds a company registration number (CRN) + VAT number to companies — these
--     are needed to query Companies House (nothing can be looked up without a CRN).
-- (2) kyc_reports — one row per KYC report run (an audit trail). summary holds the
--     headline findings for list views; payload holds the full normalised report.
-- New company columns are nullable and the table fails soft, so existing rows stay
-- valid and the feature degrades gracefully when Companies House isn't configured.
--
-- ADAPTED FROM SUPABASE: Row-Level Security dropped; created_by now references
-- public.users(id).

alter table public.companies add column if not exists company_number text;
alter table public.companies add column if not exists vat_number text;

-- ─────────────────────────────────────────────────────────────────────────────
-- KYC report run status + computed risk rating
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  create type public.kyc_report_status as enum ('pending', 'complete', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.kyc_risk as enum ('low', 'medium', 'high', 'unknown');
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- kyc_reports — stored report runs, scoped to the agency like every domain table
-- ─────────────────────────────────────────────────────────────────────────────
create table public.kyc_reports (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  company_id     uuid not null references public.companies(id) on delete cascade,
  company_number text,
  status         public.kyc_report_status not null default 'pending',
  risk_rating    public.kyc_risk not null default 'unknown',
  sources        text[] not null default '{}',
  flags          text[] not null default '{}',
  summary        jsonb,
  payload        jsonb,
  error          text,
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index kyc_reports_agency_idx  on public.kyc_reports(agency_id);
create index kyc_reports_company_idx on public.kyc_reports(company_id, created_at desc);

create trigger trg_kyc_reports_updated before update on public.kyc_reports
  for each row execute function public.set_updated_at();
