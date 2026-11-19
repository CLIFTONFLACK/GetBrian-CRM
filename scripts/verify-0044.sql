-- Verifies db/migrations/0044_date_updated_rating.sql after it has been applied.
-- NOT a migration: it lives in scripts/ because every file in db/migrations is
-- replayed by the runner. Run it by hand against a database that has 0044:
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/verify-0044.sql
--
-- ON_ERROR_STOP is required. Without it psql prints the error, runs the
-- rollback and exits 0, so a failed check would read as a pass to anything
-- that looks at the exit code. The only proof of success is the NOTICE
-- "verify-0044: all checks passed".
--
-- It runs inside begin ... rollback, inserts its own agency and rows, and
-- leaves nothing behind. Any failed check raises an exception with the check
-- name in the message.
--
-- now() is constant inside a transaction, so the rows are INSERTED with fixed
-- past dates (an insert does not fire the update trigger). Each update is then
-- compared with those known values, which a moved date can never equal.

begin;

do $$
declare
  past     constant timestamptz := '2020-01-01 00:00:00+00';
  touched  constant timestamptz := '2021-06-01 00:00:00+00';
  supplied constant timestamptz := '2022-06-01 00:00:00+00';
  a  uuid;
  c  uuid;
  k  uuid;
  r  uuid;
  u  timestamptz;
  d  timestamptz;
begin
  -- Negative control: the "moved" value must differ from the fixed past value,
  -- or every check below would pass without proving anything.
  if now() = past then raise exception 'control: now() equals the fixed past date'; end if;

  insert into public.agencies (name) values ('verify-0044 temp agency') returning id into a;

  -- ── companies ────────────────────────────────────────────────────────────
  -- Case 1: field edit moves both dates to now().
  insert into public.companies (agency_id, name, updated_at, date_updated)
    values (a, 'v0044 c1', past, past) returning id into c;
  update public.companies set name = 'v0044 c1 edited' where id = c;
  select updated_at, date_updated into u, d from public.companies where id = c;
  if u is distinct from now() then raise exception 'companies field edit: updated_at did not move (%)', u; end if;
  if d is distinct from now() then raise exception 'companies field edit: date_updated did not move (%)', d; end if;

  -- Case 2: touch moves date_updated only.
  insert into public.companies (agency_id, name, updated_at, date_updated)
    values (a, 'v0044 c2', past, past) returning id into c;
  update public.companies set date_updated = touched where id = c;
  select updated_at, date_updated into u, d from public.companies where id = c;
  if u is distinct from past then raise exception 'companies touch: updated_at moved (%)', u; end if;
  if d is distinct from touched then raise exception 'companies touch: date_updated not set (%)', d; end if;

  -- Case 3: an explicit date_updated next to a field edit keeps the explicit date.
  insert into public.companies (agency_id, name, updated_at, date_updated)
    values (a, 'v0044 c3', past, past) returning id into c;
  update public.companies set name = 'v0044 c3 edited', date_updated = supplied where id = c;
  select updated_at, date_updated into u, d from public.companies where id = c;
  if u is distinct from now() then raise exception 'companies explicit date: updated_at did not move (%)', u; end if;
  if d is distinct from supplied then raise exception 'companies explicit date: date_updated overwritten (%)', d; end if;

  -- Case 4: a no-op update moves nothing.
  insert into public.companies (agency_id, name, updated_at, date_updated)
    values (a, 'v0044 c4', past, past) returning id into c;
  update public.companies set name = name where id = c;
  select updated_at, date_updated into u, d from public.companies where id = c;
  if u is distinct from past then raise exception 'companies no-op: updated_at moved (%)', u; end if;
  if d is distinct from past then raise exception 'companies no-op: date_updated moved (%)', d; end if;

  -- ── contacts ─────────────────────────────────────────────────────────────
  insert into public.contacts (agency_id, first_name, updated_at, date_updated)
    values (a, 'v0044 k1', past, past) returning id into k;
  update public.contacts set first_name = 'v0044 k1 edited' where id = k;
  select updated_at, date_updated into u, d from public.contacts where id = k;
  if u is distinct from now() or d is distinct from now() then
    raise exception 'contacts field edit: dates % / %', u, d; end if;

  insert into public.contacts (agency_id, first_name, updated_at, date_updated)
    values (a, 'v0044 k2', past, past) returning id into k;
  update public.contacts set date_updated = touched where id = k;
  select updated_at, date_updated into u, d from public.contacts where id = k;
  if u is distinct from past or d is distinct from touched then
    raise exception 'contacts touch: dates % / %', u, d; end if;

  insert into public.contacts (agency_id, first_name, updated_at, date_updated)
    values (a, 'v0044 k3', past, past) returning id into k;
  update public.contacts set first_name = 'v0044 k3 edited', date_updated = supplied where id = k;
  select updated_at, date_updated into u, d from public.contacts where id = k;
  if u is distinct from now() or d is distinct from supplied then
    raise exception 'contacts explicit date: dates % / %', u, d; end if;

  insert into public.contacts (agency_id, first_name, updated_at, date_updated)
    values (a, 'v0044 k4', past, past) returning id into k;
  update public.contacts set first_name = first_name where id = k;
  select updated_at, date_updated into u, d from public.contacts where id = k;
  if u is distinct from past or d is distinct from past then
    raise exception 'contacts no-op: dates % / %', u, d; end if;

  -- ── requirements ─────────────────────────────────────────────────────────
  insert into public.requirements (agency_id, title, updated_at, date_updated)
    values (a, 'v0044 r1', past, past) returning id into r;
  update public.requirements set title = 'v0044 r1 edited' where id = r;
  select updated_at, date_updated into u, d from public.requirements where id = r;
  if u is distinct from now() or d is distinct from now() then
    raise exception 'requirements field edit: dates % / %', u, d; end if;

  insert into public.requirements (agency_id, title, updated_at, date_updated)
    values (a, 'v0044 r2', past, past) returning id into r;
  update public.requirements set date_updated = touched where id = r;
  select updated_at, date_updated into u, d from public.requirements where id = r;
  if u is distinct from past or d is distinct from touched then
    raise exception 'requirements touch: dates % / %', u, d; end if;

  insert into public.requirements (agency_id, title, updated_at, date_updated)
    values (a, 'v0044 r3', past, past) returning id into r;
  update public.requirements set title = 'v0044 r3 edited', date_updated = supplied where id = r;
  select updated_at, date_updated into u, d from public.requirements where id = r;
  if u is distinct from now() or d is distinct from supplied then
    raise exception 'requirements explicit date: dates % / %', u, d; end if;

  insert into public.requirements (agency_id, title, updated_at, date_updated)
    values (a, 'v0044 r4', past, past) returning id into r;
  update public.requirements set title = title where id = r;
  select updated_at, date_updated into u, d from public.requirements where id = r;
  if u is distinct from past or d is distinct from past then
    raise exception 'requirements no-op: dates % / %', u, d; end if;

  -- ── listing_rating is not a form edit ────────────────────────────────────
  -- Rating plus date_updated (what setRequirementListingRating sends): the lock
  -- token stays, the activity date moves.
  insert into public.requirements (agency_id, title, updated_at, date_updated)
    values (a, 'v0044 r5', past, past) returning id into r;
  update public.requirements set listing_rating = 4, date_updated = touched where id = r;
  select updated_at, date_updated into u, d from public.requirements where id = r;
  if u is distinct from past then raise exception 'requirements rating+touch: updated_at moved (%)', u; end if;
  if d is distinct from touched then raise exception 'requirements rating+touch: date_updated not set (%)', d; end if;
  if (select listing_rating from public.requirements where id = r) is distinct from 4 then
    raise exception 'requirements rating+touch: rating not stored';
  end if;
  -- Rating alone: nothing moves.
  insert into public.requirements (agency_id, title, updated_at, date_updated)
    values (a, 'v0044 r6', past, past) returning id into r;
  update public.requirements set listing_rating = 3 where id = r;
  select updated_at, date_updated into u, d from public.requirements where id = r;
  if u is distinct from past or d is distinct from past then
    raise exception 'requirements rating alone: dates % / %', u, d; end if;

  -- ── listing_rating: 0 and 6 rejected, 5 accepted, null accepted ──────────
  begin
    update public.requirements set listing_rating = 0 where id = r;
    raise exception 'listing_rating 0 was accepted';
  exception when check_violation then
    null;
  end;
  begin
    update public.requirements set listing_rating = 6 where id = r;
    raise exception 'listing_rating 6 was accepted';
  exception when check_violation then
    null;
  end;
  update public.requirements set listing_rating = 5 where id = r;
  if (select listing_rating from public.requirements where id = r) is distinct from 5 then
    raise exception 'listing_rating 5 was not stored';
  end if;
  update public.requirements set listing_rating = null where id = r;

  raise notice 'verify-0044: all checks passed';
end;
$$;

rollback;
