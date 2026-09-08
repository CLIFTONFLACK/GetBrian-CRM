-- 0036: give bulk CSV/XLS imports a stable identity, so re-uploading a file
-- updates the rows it already created instead of duplicating them.
--
-- Background: the importer (src/lib/actions/import-data.ts) writes through the
-- DAO layer directly. Companies and contacts were de-duplicated in application
-- code (and *skipped*, never updated); requirements and listings had no
-- duplicate check at all, so every re-upload inserted a fresh copy of every row.
--
-- Listings already have somewhere to put a caller-supplied identity:
-- disposals.source_ref, covered by unique (agency_id, source, source_ref) from
-- 0004. The CSV path simply never populated it (and NULLs never conflict, which
-- is why that index has been inert for imports). No schema change is needed
-- there — only the importer had to start writing the column.
--
-- Requirements have no such column, so add one. It is deliberately free text:
-- it holds the reference from whatever system the spreadsheet came from, which
-- may be a number, a code or a slug.
--
-- The matching UNIQUE indexes live in 0041, on their own (and last), because a unique
-- index cannot be created over a table that already contains duplicates — that
-- migration is allowed to fail loudly and be re-run after a clean-up, while
-- this one must always apply.

alter table public.requirements
  add column if not exists external_ref text;

-- Non-unique: the lookup index. 0041 adds the uniqueness once the data is known
-- to be clean.
create index if not exists requirements_external_ref_idx
  on public.requirements (agency_id, lower(external_ref))
  where external_ref is not null and external_ref <> '';

comment on column public.requirements.external_ref is
  'Caller-supplied reference from a bulk import (the external_ref CSV column). '
  'When present, a re-upload of the same reference updates this row rather than '
  'inserting a new one. Null for requirements created through the UI.';
