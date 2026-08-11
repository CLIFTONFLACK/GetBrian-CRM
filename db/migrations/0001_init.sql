-- CDG-CRM Phase 1 — data layer (adapted for plain Postgres / Neon)
-- Multi-tenant (per-agency) schema for the UK leisure & licensed property sector.
--
-- ADAPTED FROM SUPABASE: the original 0001 built this schema on top of
-- Supabase Auth (auth.users) with Row-Level Security isolating every row by
-- agency membership, plus SECURITY DEFINER helpers (auth_agency_ids(),
-- is_agency_admin()) and a handle_new_user()/seed_agency() signup trigger on
-- auth.users. None of that exists on plain Postgres. This version:
--   - defines a plain `public.users` table (merges auth.users + the old
--     public.profiles table from 0008/0010/0014_agent_socials) up front so
--     every FK that used to point at auth.users(id) can point here instead;
--   - drops RLS entirely — tenant isolation is enforced application-side by
--     the DAO layer (every query takes a mandatory agencyId);
--   - drops auth_agency_ids()/is_agency_admin() (RLS helpers, no longer
--     needed) and handle_new_user()/seed_agency() (the "create an agency +
--     seed demo data on signup" trigger) — that behavior is reimplemented as
--     plain application code in the sign-up Server Action.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums (categorical domain values; mirror src/lib/badges.ts)
-- ─────────────────────────────────────────────────────────────────────────────
create type public.member_role        as enum ('admin', 'agent');
create type public.company_type       as enum ('operator', 'landlord', 'agent', 'vendor', 'other');
create type public.contact_role       as enum ('acquisitions', 'landlord', 'solicitor', 'agent', 'finance', 'other');
create type public.use_class          as enum ('E', 'sui_generis_pub_bar', 'sui_generis_nightclub', 'sui_generis_hot_food', 'A3', 'A4', 'A5', 'other');
create type public.licence_status     as enum ('held', 'late', 'none');
create type public.tenure_type        as enum ('freehold', 'leasehold', 'assignment', 'new_letting');
create type public.listing_status     as enum ('available', 'under_offer', 'let', 'sold', 'withdrawn');
create type public.requirement_status as enum ('active', 'on_hold', 'satisfied', 'withdrawn');
create type public.deal_stage         as enum ('lead', 'viewing', 'offer', 'heads_of_terms', 'legal', 'completed', 'fell_through');
create type public.activity_type      as enum ('call', 'email', 'viewing', 'note', 'meeting', 'task');
create type public.match_status       as enum ('suggested', 'shortlisted', 'rejected', 'converted');
create type public.entity_type        as enum ('company', 'contact', 'listing', 'requirement', 'deal');

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Users (replaces Supabase auth.users + public.profiles, collapsed into one
-- plain table — see header note). Field list ports 0008_profiles.sql
-- (full_name), 0010_editable_profiles.sql (phone, avatar_url) and
-- 0014_agent_socials.sql (linkedin_url, x_url) faithfully; those three files
-- are dropped from this migration set as a result (see report).
-- password_hash is bcrypt (crypt()/gen_salt('bf'), pgcrypto) or an
-- Auth.js-compatible hash written by the new sign-up Server Action.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  full_name     text,
  phone         text,
  linkedin_url  text,
  x_url         text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger trg_users_updated before update on public.users
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Tenancy: agencies + members
-- ─────────────────────────────────────────────────────────────────────────────
create table public.agencies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.agency_members (
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  role        public.member_role not null default 'agent',
  created_at  timestamptz not null default now(),
  primary key (agency_id, user_id)
);
create index agency_members_user_idx on public.agency_members(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Companies & contacts
-- ─────────────────────────────────────────────────────────────────────────────
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  name        text not null,
  type        public.company_type not null default 'operator',
  sector_tags text[] not null default '{}',
  website     text,
  phone       text,
  notes       text,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index companies_agency_idx on public.companies(agency_id);

create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  company_id  uuid references public.companies(id) on delete set null,
  first_name  text not null,
  last_name   text,
  email       text,
  phone       text,
  role        public.contact_role not null default 'other',
  notes       text,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index contacts_agency_idx on public.contacts(agency_id);
create index contacts_company_idx on public.contacts(company_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Listings (supply). Superseded by `disposals` in 0004_unify_listings_into_disposals.sql
-- (which drops this table and repoints deals/matches) — kept here to preserve
-- the original migration history faithfully.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.listings (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references public.agencies(id) on delete cascade,
  company_id      uuid references public.companies(id) on delete set null, -- landlord / vendor
  title           text not null,
  address_line1   text,
  address_line2   text,
  town            text,
  region          text,
  postcode        text,
  lat             double precision,
  lng             double precision,
  size_sqft       numeric(10,2),
  size_sqm        numeric(10,2),
  frontage_ft     numeric(8,2),
  use_class       public.use_class not null default 'E',
  licence         public.licence_status not null default 'none',
  licence_hours   text,
  capacity        integer,
  covers_internal integer,
  covers_external integer,
  kitchen_extraction boolean not null default false,
  three_phase_power  boolean not null default false,
  gas             boolean not null default false,
  tenure          public.tenure_type not null default 'leasehold',
  tied            boolean not null default false,
  rent            numeric(12,2),
  premium         numeric(12,2),
  fixtures_fittings numeric(12,2),
  goodwill        numeric(12,2),
  rateable_value  numeric(12,2),
  epc_rating      text,
  service_charge  numeric(12,2),
  turnover        numeric(12,2),
  barrelage       numeric(10,2),
  status          public.listing_status not null default 'available',
  description     text,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index listings_agency_idx on public.listings(agency_id);
create index listings_status_idx on public.listings(agency_id, status);
create index listings_town_idx   on public.listings(agency_id, town);

-- ─────────────────────────────────────────────────────────────────────────────
-- Requirements (demand)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.requirements (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references public.agencies(id) on delete cascade,
  company_id      uuid references public.companies(id) on delete set null, -- operator
  contact_id      uuid references public.contacts(id) on delete set null,
  title           text not null,
  target_towns    text[] not null default '{}',
  target_regions  text[] not null default '{}',
  min_sqft        numeric(10,2),
  max_sqft        numeric(10,2),
  min_covers      integer,
  max_covers      integer,
  use_classes     public.use_class[] not null default '{}',
  max_rent        numeric(12,2),
  max_premium     numeric(12,2),
  tenure_prefs    public.tenure_type[] not null default '{}',
  notes           text,
  status          public.requirement_status not null default 'active',
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index requirements_agency_idx on public.requirements(agency_id);
create index requirements_company_idx on public.requirements(company_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Deals (links supply + demand + parties)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.deals (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references public.agencies(id) on delete cascade,
  listing_id      uuid references public.listings(id) on delete set null,
  requirement_id  uuid references public.requirements(id) on delete set null,
  company_id      uuid references public.companies(id) on delete set null,
  title           text not null,
  stage           public.deal_stage not null default 'lead',
  value           numeric(12,2),
  hot_terms       text,
  notes           text,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index deals_agency_idx on public.deals(agency_id);
create index deals_stage_idx  on public.deals(agency_id, stage);

-- ─────────────────────────────────────────────────────────────────────────────
-- Activities (polymorphic timeline)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.activities (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  type          public.activity_type not null default 'note',
  subject       text,
  body          text,
  entity_type   public.entity_type,
  entity_id     uuid,
  occurred_at   timestamptz not null default now(),
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index activities_agency_idx on public.activities(agency_id);
create index activities_entity_idx on public.activities(agency_id, entity_type, entity_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Matches (generated supply↔demand candidates)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.matches (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references public.agencies(id) on delete cascade,
  listing_id      uuid not null references public.listings(id) on delete cascade,
  requirement_id  uuid not null references public.requirements(id) on delete cascade,
  score           numeric(5,2) not null default 0,
  reasons         jsonb not null default '[]',
  status          public.match_status not null default 'suggested',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (listing_id, requirement_id)
);
create index matches_agency_idx on public.matches(agency_id);
create index matches_listing_idx on public.matches(listing_id);
create index matches_requirement_idx on public.matches(requirement_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ─────────────────────────────────────────────────────────────────────────────
create trigger trg_agencies_updated     before update on public.agencies     for each row execute function public.set_updated_at();
create trigger trg_companies_updated     before update on public.companies     for each row execute function public.set_updated_at();
create trigger trg_contacts_updated      before update on public.contacts      for each row execute function public.set_updated_at();
create trigger trg_listings_updated      before update on public.listings      for each row execute function public.set_updated_at();
create trigger trg_requirements_updated  before update on public.requirements  for each row execute function public.set_updated_at();
create trigger trg_deals_updated         before update on public.deals         for each row execute function public.set_updated_at();
create trigger trg_matches_updated       before update on public.matches       for each row execute function public.set_updated_at();

-- No Row-Level Security, no auth_agency_ids()/is_agency_admin() helpers, no
-- seed_agency()/handle_new_user() signup trigger — see header note.
