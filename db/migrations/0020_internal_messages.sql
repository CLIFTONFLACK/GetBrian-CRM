-- Phase 4 — internal user-to-user messages
-- Powers "My Messages" (inbox) and the "Send to team" action on record pages. A
-- message optionally carries a `link` to the record it was sent about.
--
-- ADAPTED FROM SUPABASE: Row-Level Security dropped (insert-as-self, read own
-- sent/received, mark-read by recipient only, delete by either party — all
-- enforced application-side now). sender_id/recipient_id now reference
-- public.users(id).

create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references public.agencies(id) on delete cascade,
  sender_id    uuid not null references public.users(id) on delete cascade,
  recipient_id uuid not null references public.users(id) on delete cascade,
  subject      text,
  body         text not null,
  link         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index messages_recipient_idx on public.messages(recipient_id, read_at);
create index messages_agency_idx    on public.messages(agency_id, created_at desc);
