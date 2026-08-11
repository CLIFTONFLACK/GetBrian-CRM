-- Upgrades batch — Phase 0
-- (#2)  disposal_documents — uploaded PDFs (floor plans, vendor docs) per listing.
-- (#10) disposal_areas     — the available-area schedule (per-floor / per-unit rows).
--
-- ADAPTED FROM SUPABASE: dropped the private 'disposal-docs' storage.buckets
-- insert + its storage.objects policies (file storage moves to Vercel Blob —
-- see 0017, also dropped from this set, which tightened those same policies to
-- close a cross-tenant leak; Blob needs its own app-layer authorization check,
-- via a signed-proxy route per the migration plan, not DB policies). Row-Level
-- Security on disposal_documents/disposal_areas dropped; uploaded_by now
-- references public.users(id). disposal_documents.file_path keeps its meaning
-- as a plain metadata column (now a Blob key/path rather than a Storage path) —
-- this table is ordinary metadata, not storage-specific.

-- ─────────────────────────────────────────────────────────────────────────────
-- Documents
-- ─────────────────────────────────────────────────────────────────────────────
create table public.disposal_documents (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  disposal_id uuid not null references public.disposals(id) on delete cascade,
  name        text not null,
  doc_type    text not null default 'other'
                check (doc_type in ('floor_plan','vendor','brochure','epc','other')),
  file_path   text not null,          -- Vercel Blob key/path
  size_bytes  bigint,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index disposal_documents_agency_idx   on public.disposal_documents(agency_id);
create index disposal_documents_disposal_idx on public.disposal_documents(disposal_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Available-area schedule
-- ─────────────────────────────────────────────────────────────────────────────
create table public.disposal_areas (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references public.agencies(id) on delete cascade,
  disposal_id  uuid not null references public.disposals(id) on delete cascade,
  name         text not null,          -- e.g. "Ground floor", "Basement", "Unit 2"
  size_sqft    numeric,
  size_sqm     numeric,
  rent_pa      numeric,
  availability text,                   -- e.g. "Available", "Under offer", "Let"
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index disposal_areas_disposal_idx on public.disposal_areas(disposal_id);
create index disposal_areas_agency_idx   on public.disposal_areas(agency_id);
