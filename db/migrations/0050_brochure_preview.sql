-- 0050: a page 1 preview image for a listing's brochure.
--
-- WHAT IT DOES
-- brochure_url points at a PDF on the agent's own site (or an S3 bucket). The
-- listing panel shows page 1 of that PDF as a thumbnail. The image is drawn on
-- the server and stored in our Vercel Blob store. One row per listing:
--   source_url   the brochure link the image was drawn from. The image is valid
--                only while this equals the listing's current brochure_url, so
--                changing the link needs no clean-up step.
--   preview_url  the stored image. Null records a failed try.
--   checked_at   when we last tried. A failed try is not retried for a while, so
--                a PDF that cannot be drawn is not retried on every panel open.
--
-- WHY A SEPARATE TABLE
-- public.disposals has an updated_at trigger. Writing the preview onto the
-- listing row would move updated_at when someone merely opened a panel, and an
-- open edit form would then report "changed by someone else".
--
-- DEPLOY ORDER
-- Apply this BEFORE the code goes live: the listing panel reads the table.
-- Old code against the new schema is safe (it never reads the table).
--
-- Deleting a listing removes its row (cascade). The stored image in Blob is
-- removed by the app (deleteDisposal returns its url).
--
-- No RLS and no grants: tenants are isolated in the application layer (AGENTS.md).
--
-- Idempotent: safe to run twice. No begin/commit inside; the runner decides.

create table if not exists public.disposal_brochure_previews (
  disposal_id uuid primary key references public.disposals(id) on delete cascade,
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  source_url  text not null,
  preview_url text,
  checked_at  timestamptz not null default now()
);

create index if not exists disposal_brochure_previews_agency_idx
  on public.disposal_brochure_previews (agency_id);
