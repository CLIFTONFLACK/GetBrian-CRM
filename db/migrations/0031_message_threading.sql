-- Comms v2 — message threading
-- A reply carries the id of the message it answers. `on delete set null` keeps
-- replies readable when the original is deleted by either party.

alter table public.messages
  add column if not exists parent_id uuid references public.messages(id) on delete set null;

create index if not exists messages_parent_idx on public.messages(parent_id);
