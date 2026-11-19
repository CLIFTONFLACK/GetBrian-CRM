-- 0045: documents attached to a company or a contact.
--
-- Same shape and same rules as requirement_documents (0039): file bytes live in
-- Vercel Blob, this table is ordinary metadata, `file_path` holds the Blob URL,
-- there is no RLS, and authorization is app-layer (agency-scoped queries plus a
-- signed download proxy at /api/entity-docs/[id]).
--
-- One table for two owners, keyed by (entity_type, entity_id), because the two
-- owners are used identically. 0039 argues for one owner column per table; the
-- ownership check here is never conditional, though: every query filters on
-- agency_id AND entity_type AND entity_id, and every write first proves the
-- record exists in the caller's agency (entityExistsInAgency).
--
-- There is no foreign key on entity_id (it points at two tables), so the
-- triggers at the end delete a record's document rows when the record is
-- deleted. The Blob objects are not deleted by that: the app deletes them when a
-- document is removed from the panel, but a deleted company or contact leaves
-- its files in Blob, unreachable because no row points at them.
--
-- Safe to run more than once.

create table if not exists public.entity_documents (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references public.agencies(id) on delete cascade,
  entity_type  text not null check (entity_type in ('company', 'contact')),
  entity_id    uuid not null,
  file_path    text not null,          -- Vercel Blob URL
  file_name    text not null,
  content_type text,
  size_bytes   bigint,
  uploaded_by  uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists entity_documents_entity_idx
  on public.entity_documents(agency_id, entity_type, entity_id);

comment on table public.entity_documents is
  'Files attached to a company or contact. Bytes live in Vercel Blob; downloads '
  'go through the signed proxy at /api/entity-docs/[id], never the raw Blob URL.';

create or replace function public.delete_entity_documents() returns trigger
language plpgsql as $$
begin
  delete from public.entity_documents
  where entity_type = tg_argv[0] and entity_id = old.id;
  return old;
end
$$;

do $$ begin
  create trigger trg_companies_delete_entity_documents
    after delete on public.companies
    for each row execute function public.delete_entity_documents('company');
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_contacts_delete_entity_documents
    after delete on public.contacts
    for each row execute function public.delete_entity_documents('contact');
exception when duplicate_object then null; end $$;
