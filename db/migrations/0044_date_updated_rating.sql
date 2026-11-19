-- 0044: "date updated" on companies, contacts and requirements; requirement
-- listing rating; contact mobile and property-alert consent.
--
-- WHY A SECOND DATE
-- updated_at is the optimistic-lock token. The edit forms read it, then save
-- with `where ... and updated_at = <value the form was loaded with>`
-- (queries/companies.ts, contacts.ts, requirements.ts). If anything else moves
-- it, an open edit form fails with a false conflict. So a child write (an
-- activity logged, a document attached, an agent added, a contact linked) must
-- NOT change updated_at, yet the record should still read as "recently worked".
-- date_updated is that second date: "when did anyone last touch this record,
-- by edit or by child write, or when did the source system last touch it".
--
-- THE TRIGGER
-- public.set_updated_and_date_updated() replaces the old
-- public.set_updated_at() on these three tables only. It compares NEW with OLD
-- with both date columns AND listing_rating removed, so only real form data
-- columns count. A rating change is not a form edit: it must not invalidate an
-- open edit form (the form's updated_at would no longer match), but it still
-- counts as activity, so setRequirementListingRating sets date_updated itself
-- in the same UPDATE (that is case 2 below):
--
--   1. No data column changed, date_updated unchanged  (a no-op update)
--        updated_at and date_updated both keep their OLD values.
--   2. No data column changed, date_updated changed     (a "touch", or an
--        import that only carries a source date)
--        updated_at keeps its OLD value (the lock token must not move);
--        date_updated takes the new value.
--   3. A data column changed
--        updated_at = now().
--        date_updated = now(), unless the statement set date_updated itself
--        (NEW differs from OLD), in which case the supplied value is kept.
--        That is how an import carries a source date next to a field edit.
--        Limit: a supplied date EQUAL to the stored one cannot be told apart
--        from "not supplied", so it becomes now(). The importer therefore
--        re-asserts its source date with a follow-up date-only update (case 2).
--
-- DEPLOY ORDER
-- Apply this migration BEFORE the code that selects the new columns goes live.
-- New code against the old schema fails every company, contact and requirement
-- read with "column does not exist". Old code against the new schema is safe.
--
-- LOCKS
-- The file runs as one transaction and holds ACCESS EXCLUSIVE on the three
-- tables through the backfill. That is seconds at the current size (a few
-- thousand rows each). Split it (batched backfill, NOT VALID check, validate,
-- then set not null) before running it against tables far larger than that.
--
-- Behaviour change to know about: the old trigger set updated_at on EVERY
-- update, including one that wrote identical values. Now a no-op update leaves
-- updated_at alone. Nothing in src/ depends on the old bump (the optimistic
-- lock still works: an unchanged row keeps an unchanged token).
--
-- Idempotent: safe to run twice. set_updated_at() and every other table's
-- trigger are left alone.
--
-- Order matters. The column is added first (nullable), then the new trigger is
-- installed, and only then is the backfill run. With the OLD trigger still in
-- place the backfill would have moved updated_at on every row.

-- a. date_updated -------------------------------------------------------------

alter table public.companies    add column if not exists date_updated timestamptz;
alter table public.contacts     add column if not exists date_updated timestamptz;
alter table public.requirements add column if not exists date_updated timestamptz;

-- b. trigger function and trigger swap ----------------------------------------

create or replace function public.set_updated_and_date_updated()
returns trigger language plpgsql set search_path = '' as $$
declare
  data_changed boolean;
begin
  -- listing_rating exists on requirements only; removing a key that is absent
  -- (companies, contacts) is a no-op for jsonb.
  data_changed := (to_jsonb(new) - 'updated_at' - 'date_updated' - 'listing_rating')
                  is distinct from (to_jsonb(old) - 'updated_at' - 'date_updated' - 'listing_rating');

  if not data_changed then
    -- Cases 1 and 2: the lock token never moves. date_updated stays as the
    -- statement left it (equal to OLD on a no-op, the supplied value on a touch).
    new.updated_at := old.updated_at;
    return new;
  end if;

  -- Case 3: a real edit.
  new.updated_at := now();
  if new.date_updated is not distinct from old.date_updated then
    new.date_updated := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_companies_updated on public.companies;
create trigger trg_companies_updated
  before update on public.companies
  for each row execute function public.set_updated_and_date_updated();

drop trigger if exists trg_contacts_updated on public.contacts;
create trigger trg_contacts_updated
  before update on public.contacts
  for each row execute function public.set_updated_and_date_updated();

drop trigger if exists trg_requirements_updated on public.requirements;
create trigger trg_requirements_updated
  before update on public.requirements
  for each row execute function public.set_updated_and_date_updated();

-- Backfill. Only date_updated changes, so the new trigger treats it as a touch
-- and leaves updated_at alone.
update public.companies    set date_updated = updated_at where date_updated is null;
update public.contacts     set date_updated = updated_at where date_updated is null;
update public.requirements set date_updated = updated_at where date_updated is null;

alter table public.companies    alter column date_updated set default now();
alter table public.contacts     alter column date_updated set default now();
alter table public.requirements alter column date_updated set default now();

alter table public.companies    alter column date_updated set not null;
alter table public.contacts     alter column date_updated set not null;
alter table public.requirements alter column date_updated set not null;

-- c. requirement listing rating -----------------------------------------------

alter table public.requirements add column if not exists listing_rating smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirements_listing_rating_range'
      and conrelid = 'public.requirements'::regclass
  ) then
    alter table public.requirements
      add constraint requirements_listing_rating_range
      check (listing_rating is null or listing_rating between 1 and 5);
  end if;
end;
$$;

-- Serves the priority list: strong briefs (4 and 5) per agency.
create index if not exists requirements_listing_rating_idx
  on public.requirements (agency_id, listing_rating)
  where listing_rating >= 4;

-- d. contact mobile and property alerts ---------------------------------------

alter table public.contacts add column if not exists mobile text;
alter table public.contacts add column if not exists marketing_property_alerts boolean;

comment on column public.requirements.listing_rating is
  'Agent rating of the brief, 1 (weak) to 5 (strong). Null means unrated.';
comment on column public.companies.date_updated is
  'Last time the record or one of its children was touched, or the source system date from an import. Unlike updated_at it is not the optimistic-lock token.';
comment on column public.contacts.date_updated is
  'Last time the record or one of its children was touched, or the source system date from an import. Unlike updated_at it is not the optimistic-lock token.';
comment on column public.requirements.date_updated is
  'Last time the record or one of its children was touched, or the source system date from an import. Unlike updated_at it is not the optimistic-lock token.';
