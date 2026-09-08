-- 0038: a company's primary contact.
--
-- There was no such concept: a company's people were simply the contacts whose
-- company_id pointed at it, with no way to say which one you'd actually write
-- to. Send flows therefore offered the entire agency contact roster and made
-- the agent pick every time.
--
-- Modelled as a flag on the contact rather than a column on the company
-- (companies.primary_contact_id), because the flag keeps the two sides from
-- disagreeing: a company row can't point at a contact that belongs to a
-- different company, and re-parenting a contact carries its own flag with it.
-- The cost is that "who is the primary" is a lookup rather than a join column,
-- which is fine at this scale.
--
-- No backfill. Existing companies have no primary until someone sets one, and
-- the UI falls back to the first contact by name, exactly as before. Promoting
-- the oldest contact automatically would be a guess about the business, and a
-- wrong primary is worse than none: it silently changes who gets emailed.

alter table public.contacts
  add column if not exists is_primary boolean not null default false;

-- At most one primary per company. Partial, so the unlimited contacts that are
-- NOT primary don't collide with each other, and contacts with no company
-- (company_id is null) are excluded entirely — "primary contact of nothing"
-- has no meaning to enforce.
create unique index if not exists contacts_one_primary_per_company
  on public.contacts (company_id)
  where is_primary and company_id is not null;

comment on column public.contacts.is_primary is
  'The company''s default point of contact — pre-selected as the recipient in '
  'the send flows. At most one per company (contacts_one_primary_per_company).';
