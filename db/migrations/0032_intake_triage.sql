-- Public intake triage queue.
--
-- Publicly-submitted requirements used to be written straight into
-- companies/contacts/requirements, so anonymous input went live as an active,
-- matchable brief and could be merged onto an existing company by a wildcard
-- name match. Submissions now land here as `pending` rows and only become CRM
-- records when an agent approves them from /intake.
--
-- ADAPTED FROM SUPABASE: writes used to come from the public form via the
-- Supabase service-role client, which bypassed Row-Level Security (there was
-- deliberately no `anon` insert policy, so the table couldn't be written to
-- with the publishable key). RLS is dropped entirely here; the public intake
-- Server Action now writes with a normal trusted DB connection and the same
-- "no direct public write path" guarantee comes from that action being the
-- only code that touches this table with an agencyId it controls.
-- reviewed_by now references public.users(id).

create table if not exists public.intake_submissions (
  id                     uuid primary key default gen_random_uuid(),
  agency_id              uuid not null references public.agencies(id) on delete cascade,
  status                 text not null default 'pending'
                           check (status in ('pending', 'approved', 'rejected')),

  -- Exactly what the public form collects (kept verbatim — never edited here).
  company_name           text not null,
  first_name             text not null,
  last_name              text,
  email                  text not null,
  phone                  text,
  property_type          text,
  -- Comma-joined picks from the UK locations combobox (free text allowed);
  -- split + classified into the requirement's town/county/region/district
  -- arrays at approval time.
  target_locations       text,
  min_sqft               integer,
  max_sqft               integer,
  min_covers              integer,
  max_covers              integer,
  max_rent                numeric,
  max_premium             numeric,
  notes                  text,

  -- Triage outcome.
  created_requirement_id uuid references public.requirements(id) on delete set null,
  reviewed_by            uuid references public.users(id) on delete set null,
  reviewed_at            timestamptz,
  created_at             timestamptz not null default now()
);

create index if not exists intake_submissions_agency_status_idx
  on public.intake_submissions(agency_id, status, created_at desc);
create index if not exists intake_submissions_requirement_idx
  on public.intake_submissions(created_requirement_id);
