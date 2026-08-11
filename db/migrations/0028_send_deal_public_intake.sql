-- Send Deal (external) — log every deal/requirement sent to an external
-- company/contact by email. Internal sends keep using `messages` (recipient_id
-- is a hard FK to public.users); external recipients live in companies/contacts,
-- so they get their own audit table.
--
-- ADAPTED FROM SUPABASE: Row-Level Security dropped; sent_by now references
-- public.users(id).

create table public.external_sends (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references public.agencies(id) on delete cascade,
  requirement_id   uuid references public.requirements(id) on delete set null,
  listing_id       uuid references public.disposals(id) on delete set null,
  company_id       uuid references public.companies(id) on delete set null,
  contact_id       uuid references public.contacts(id) on delete set null,
  recipient_email  text not null,
  subject          text not null,
  body             text,
  pdf_kind         text check (pdf_kind in ('branded', 'unbranded')),
  provider_id      text,
  sent_by          uuid not null references public.users(id),
  created_at       timestamptz not null default now()
);

create index external_sends_agency_idx      on public.external_sends(agency_id);
create index external_sends_requirement_idx on public.external_sends(requirement_id);
create index external_sends_listing_idx     on public.external_sends(listing_id);
create index external_sends_contact_idx     on public.external_sends(contact_id);
