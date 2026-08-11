-- Phase 1 reconciliation: the supply / Listing entity is a single table named
-- `disposals` (decision: disposals IS listings). Adopt the rich CDG-import schema
-- from the disposals workstream, and drop the thin `listings` table created in
-- 0001. The CDG importer keeps targeting `disposals`. UI keeps the "Listings" label.
--
-- ADAPTED FROM SUPABASE: dropped the `storage.buckets` insert + `storage.objects`
-- policy for the 'disposals' bucket (file storage moves to Vercel Blob, which has
-- no database-side bucket concept — see 0005/0017, also dropped from this set),
-- the `alter table ... enable row level security` + policy on `disposals`, and
-- the trailing seed_agency() redefinition (that function no longer exists — see
-- 0001's header note). `create extension if not exists pgcrypto` moved to 0001
-- since gen_random_uuid() needs it from the very first table onward.

-- 1) Tenant-scoped disposals table -------------------------------------------
create table public.disposals (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references public.agencies(id) on delete cascade,

  -- provenance
  source              text not null default 'cdg',
  source_ref          text,
  source_url          text,
  status              text,
  source_updated_at   timestamptz,

  -- identity / location
  title               text,
  summary             text,
  address_line        text,
  area                text,
  city                text,
  postcode            text,
  lat                 double precision,
  lng                 double precision,

  -- classification
  property_type       text,
  use_class           text,
  disposal_type       text not null default 'unknown'
                        check (disposal_type in ('freehold','new_lease','lease_assignment','sublease','unknown')),
  to_let              boolean not null default false,
  for_sale            boolean not null default false,

  -- commercials
  rent_pa             numeric,
  rent_raw            text,
  rent_period         text,
  premium             numeric,
  premium_raw         text,
  guide_price         numeric,
  price_qualifier     text
                        check (price_qualifier is null or price_qualifier in ('fixed','offers_in_region','offers_in_excess','on_application')),
  vat_applicable      boolean,
  rateable_value      numeric,
  business_rates      numeric,
  service_charge      numeric,
  estate_charge       numeric,
  parking_charge      numeric,

  -- lease
  tenure_raw          text,
  lease_term_years    integer,
  lease_expiry        date,
  rent_review_basis   text,
  next_rent_review    integer,
  inside_1954_act     boolean,

  -- size / capacity
  size_sqft           numeric,
  size_sqm            numeric,
  covers_internal     integer,
  covers_external     integer,
  floors              jsonb not null default '[]'::jsonb,

  -- leisure specifics
  licensing_notes     text,
  fit_out_state       text
                        check (fit_out_state is null or fit_out_state in ('fully_fitted','part_fitted','shell')),
  epc_rating          text,

  -- content
  description         text,
  location_description text,
  key_features        text[] not null default '{}',
  sections            jsonb not null default '[]'::jsonb,

  -- agent
  agent_name          text,
  agent_email         text,
  agent_phone         text,
  agent_photo         text,

  -- media
  images              jsonb not null default '[]'::jsonb,
  brochure_url        text,

  created_by          uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- one row per source listing per agency (idempotent import per tenant)
  unique (agency_id, source, source_ref)
);

create index disposals_agency_idx        on public.disposals(agency_id);
create index disposals_status_idx        on public.disposals(agency_id, status);
create index disposals_disposal_type_idx on public.disposals(agency_id, disposal_type);
create index disposals_postcode_idx      on public.disposals(agency_id, postcode);

create trigger trg_disposals_updated before update on public.disposals
  for each row execute function public.set_updated_at();

-- 2) Repoint deals/matches from listings -> disposals, drop listings ----------
update public.deals set listing_id = null;   -- sample links to soon-dropped listings
delete from public.matches;                  -- no UI yet; clear any rows
drop table if exists public.listings cascade;  -- cascade drops the old FKs
drop type if exists public.listing_status;     -- only listings used it
alter table public.deals add constraint deals_listing_id_fkey
  foreign key (listing_id) references public.disposals(id) on delete set null;
alter table public.matches add constraint matches_listing_id_fkey
  foreign key (listing_id) references public.disposals(id) on delete cascade;
