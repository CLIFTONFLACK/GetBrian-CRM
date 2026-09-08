-- 0039: documents attached to a requirement — the "landlord pack" and anything
-- else that belongs with a brief.
--
-- Deliberately a mirror of disposal_documents (0012) rather than a shared
-- polymorphic table: the two differ in what they're keyed to and in who may
-- read them, and a single documents table with a nullable disposal_id and a
-- nullable requirement_id would make the ownership check — the thing that keeps
-- one agency's files away from another's — conditional. Two narrow tables each
-- have exactly one owner column, so that check can't be got wrong.
--
-- As with disposal_documents: file bytes live in Vercel Blob, this table is
-- ordinary metadata, and `file_path` holds the Blob key/URL. There is no RLS —
-- authorization is app-layer, via the agency-scoped DAO lookups plus the signed
-- proxy route (see src/lib/requirement-docs.ts).

create table if not exists public.requirement_documents (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  name           text not null,
  doc_type       text not null default 'landlord_pack'
                   check (doc_type in ('landlord_pack','heads_of_terms','brief','other')),
  file_path      text not null,          -- Vercel Blob key/path
  size_bytes     bigint,
  uploaded_by    uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists requirement_documents_agency_idx
  on public.requirement_documents(agency_id);
create index if not exists requirement_documents_requirement_idx
  on public.requirement_documents(requirement_id);

comment on table public.requirement_documents is
  'Files attached to a requirement (landlord packs, heads of terms). Bytes live '
  'in Vercel Blob; downloads go through the signed proxy at '
  '/api/requirement-docs/[id], never the raw Blob URL.';
