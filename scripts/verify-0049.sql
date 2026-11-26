-- Verifies db/migrations/0049_notes_todos_merge.sql. NOT a migration: it lives in
-- scripts/ because every file in db/migrations is replayed by the runner. Run it
-- by hand against a database that already has 0049, from the repository root:
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/verify-0049.sql
--
-- ON_ERROR_STOP is required. Without it psql prints the error, runs the
-- rollback and exits 0, so a failed check would read as a pass. The only proof
-- of success is the NOTICE "verify-0049: all checks passed".
--
-- It runs inside begin ... rollback, makes its own agency and rows, and leaves
-- nothing behind. It re-runs the migration file itself (\i) inside the
-- transaction, which also proves the migration can run twice. Every rule has a
-- negative control: the bad value must be REJECTED, and a good value next to it
-- must be accepted.

begin;

-- Fixture: an agency, a company, a deal, an old-style task and an old-style reminder.
create temp table v0049 (k text primary key, v uuid) on commit drop;

do $$
declare
  a uuid; c uuid; d uuid; t_done uuid; t_open uuid; t_loose uuid; r_open uuid; r_done uuid;
begin
  insert into public.agencies (name) values ('verify-0049 temp agency') returning id into a;
  insert into public.companies (agency_id, name) values (a, 'v0049 company') returning id into c;
  insert into public.deals (agency_id, title) values (a, 'v0049 deal') returning id into d;

  insert into public.tasks (agency_id, title, status, due_at, entity_type, entity_id)
    values (a, 'v0049 task done', 'done', now() - interval '1 day', 'company', c) returning id into t_done;
  insert into public.tasks (agency_id, title, status, due_at, entity_type, entity_id, notified_at)
    values (a, 'v0049 task open', 'open', now() + interval '1 day', 'company', c, now()) returning id into t_open;
  -- A task with an unknown record type must still move, with no record link.
  insert into public.tasks (agency_id, title, status, entity_type, entity_id)
    values (a, 'v0049 task loose', 'open', 'widget', gen_random_uuid()) returning id into t_loose;

  insert into public.deal_reminders (agency_id, deal_id, title, due_at, done)
    values (a, d, 'v0049 reminder open', now() + interval '2 days', false) returning id into r_open;
  insert into public.deal_reminders (agency_id, deal_id, title, due_at, done)
    values (a, d, 'v0049 reminder done', now() - interval '2 days', true) returning id into r_done;

  insert into v0049 values
    ('agency', a), ('company', c), ('deal', d),
    ('t_done', t_done), ('t_open', t_open), ('t_loose', t_loose),
    ('r_open', r_open), ('r_done', r_done);
end $$;

-- Run the migration (a second time, if it is already applied) inside this transaction.
\i db/migrations/0049_notes_todos_merge.sql

do $$
declare
  a uuid := (select v from v0049 where k = 'agency');
  c uuid := (select v from v0049 where k = 'company');
  d uuid := (select v from v0049 where k = 'deal');
  n int;
  rejected boolean;
begin
  -- ── the columns exist ────────────────────────────────────────────────────
  if (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'activities'
          and column_name in ('assignee_id', 'due_at', 'status', 'completed_at',
                              'completed_by', 'notified_at', 'updated_at')) <> 7 then
    raise exception 'columns: expected 7 new columns on activities';
  end if;

  -- ── tasks moved, with their fields ───────────────────────────────────────
  select count(*) into n from public.activities
    where agency_id = a and type = 'task' and subject like 'v0049 task%';
  if n <> 3 then raise exception 'tasks moved: expected 3, got %', n; end if;

  if (select status from public.activities where id = (select v from v0049 where k = 't_done')) is distinct from 'done' then
    raise exception 'task status not kept (done)';
  end if;
  if (select completed_at from public.activities where id = (select v from v0049 where k = 't_done')) is null then
    raise exception 'a done task must have completed_at';
  end if;
  if (select completed_at from public.activities where id = (select v from v0049 where k = 't_open')) is not null then
    raise exception 'an open task must not have completed_at';
  end if;
  if (select notified_at from public.activities where id = (select v from v0049 where k = 't_open')) is null then
    raise exception 'notified_at must be kept, or the cron would send it again';
  end if;
  if (select entity_type::text from public.activities where id = (select v from v0049 where k = 't_open')) is distinct from 'company'
     or (select entity_id from public.activities where id = (select v from v0049 where k = 't_open')) is distinct from c then
    raise exception 'task record link not kept';
  end if;
  if (select entity_type from public.activities where id = (select v from v0049 where k = 't_loose')) is not null
     or (select entity_id from public.activities where id = (select v from v0049 where k = 't_loose')) is not null then
    raise exception 'a task with an unknown record type must move with no record link';
  end if;

  -- ── reminders moved onto the deal ────────────────────────────────────────
  select count(*) into n from public.activities
    where agency_id = a and entity_type = 'deal' and entity_id = d and subject like 'v0049 reminder%';
  if n <> 2 then raise exception 'reminders moved: expected 2, got %', n; end if;
  if (select status from public.activities where id = (select v from v0049 where k = 'r_open')) is distinct from 'open'
     or (select status from public.activities where id = (select v from v0049 where k = 'r_done')) is distinct from 'done' then
    raise exception 'reminder done flag not mapped to status';
  end if;

  -- ── the move is idempotent: nothing was added by running the file again ──
  select count(*) into n from public.activities where agency_id = a;
  if n <> 5 then raise exception 'idempotence: expected 5 activities for the fixture agency, got %', n; end if;

  -- ── constraints: a note, a to-do, and the bad shapes ─────────────────────
  insert into public.activities (agency_id, type, subject) values (a, 'note', 'v0049 plain note');
  insert into public.activities (agency_id, type, subject, due_at, status)
    values (a, 'note', 'v0049 todo with due date', now(), 'open');

  rejected := false;
  begin
    insert into public.activities (agency_id, type, subject, due_at) values (a, 'note', 'v0049 due without status', now());
  exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'a due date without a status must be rejected'; end if;

  rejected := false;
  begin
    insert into public.activities (agency_id, type, subject, status) values (a, 'note', 'v0049 bad status', 'maybe');
  exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'a status other than open or done must be rejected'; end if;

  -- ── updated_at moves on update ───────────────────────────────────────────
  update public.activities set updated_at = now() - interval '1 hour'
    where id = (select v from v0049 where k = 't_open');
  update public.activities set subject = 'v0049 task open (edited)'
    where id = (select v from v0049 where k = 't_open');
  if (select updated_at from public.activities where id = (select v from v0049 where k = 't_open')) < now() - interval '1 minute' then
    raise exception 'updated_at did not move on update';
  end if;

  -- ── deleting a record deletes its notes and to-dos (and only its own) ────
  insert into public.activities (agency_id, type, subject, entity_type, entity_id)
    values (a, 'note', 'v0049 other record note', 'company', gen_random_uuid());
  delete from public.companies where id = c;
  select count(*) into n from public.activities where agency_id = a and entity_type = 'company' and entity_id = c;
  if n <> 0 then raise exception 'orphans: % activities left after the company was deleted', n; end if;
  select count(*) into n from public.activities where agency_id = a and subject = 'v0049 other record note';
  if n <> 1 then raise exception 'a note on another record must survive'; end if;

  delete from public.deals where id = d;
  select count(*) into n from public.activities where agency_id = a and entity_type = 'deal' and entity_id = d;
  if n <> 0 then raise exception 'orphans: % activities left after the deal was deleted', n; end if;

end $$;

-- ── second run: what the old screens did in the gap is carried over, and what the
-- new screen did is not overwritten ──────────────────────────────────────────
-- Everything in one transaction shares one now(), so the updated_at triggers are
-- switched off while the fixture sets explicit times.
do $$
declare
  a uuid := (select v from v0049 where k = 'agency');
  d uuid; g1 uuid; g2 uuid; g3 uuid;
begin
  insert into public.deals (agency_id, title) values (a, 'v0049 gap deal') returning id into d;
  insert into public.tasks (agency_id, title, status, due_at)
    values (a, 'v0049 gap A', 'open', now() + interval '1 day') returning id into g1;
  insert into public.tasks (agency_id, title, status, due_at)
    values (a, 'v0049 gap B', 'open', now() + interval '2 days') returning id into g2;
  insert into public.deal_reminders (agency_id, deal_id, title, due_at, done)
    values (a, d, 'v0049 gap reminder', now() + interval '3 days', false) returning id into g3;
  insert into v0049 values ('g1', g1), ('g2', g2), ('g3', g3);
end $$;

\i db/migrations/0049_notes_todos_merge.sql

alter table public.tasks disable trigger trg_tasks_updated;
alter table public.activities disable trigger trg_activities_updated;

do $$
declare
  g1 uuid := (select v from v0049 where k = 'g1');
  g2 uuid := (select v from v0049 where k = 'g2');
  g3 uuid := (select v from v0049 where k = 'g3');
begin
  -- g1: changed in the OLD screen later than the copy: the old change must win.
  update public.tasks set title = 'v0049 gap A (old edit)', status = 'done',
         updated_at = now() + interval '1 hour' where id = g1;
  -- g2: changed in the NEW screen (text and a new due time, stamp cleared) while
  -- the old row still carries a sent stamp: neither must be overwritten.
  update public.activities set subject = 'v0049 gap B (new screen)',
         due_at = now() + interval '9 days', notified_at = null,
         updated_at = now() + interval '1 hour' where id = g2;
  update public.tasks set notified_at = now() where id = g2;
  -- g3: the old cron sent the reminder in the gap: the stamp must come across.
  update public.deal_reminders set notified_at = now() where id = g3;
end $$;

alter table public.tasks enable trigger trg_tasks_updated;
alter table public.activities enable trigger trg_activities_updated;

\i db/migrations/0049_notes_todos_merge.sql

do $$
declare
  g1 uuid := (select v from v0049 where k = 'g1');
  g2 uuid := (select v from v0049 where k = 'g2');
  g3 uuid := (select v from v0049 where k = 'g3');
begin
  if (select subject from public.activities where id = g1) is distinct from 'v0049 gap A (old edit)'
     or (select status from public.activities where id = g1) is distinct from 'done' then
    raise exception 'second run: a newer change from the old screen was not carried over';
  end if;
  if (select subject from public.activities where id = g2) is distinct from 'v0049 gap B (new screen)' then
    raise exception 'second run: a change made in the new screen was overwritten';
  end if;
  if (select notified_at from public.activities where id = g2) is not null then
    raise exception 'second run: a sent stamp came back after the new screen set a new due time';
  end if;
  if (select notified_at from public.activities where id = g3) is null then
    raise exception 'second run: a sent stamp from the old screen was not carried over';
  end if;
  if (select count(*) from public.activities where id in (g1, g2, g3)) <> 3 then
    raise exception 'second run: duplicates or missing rows';
  end if;

  raise notice 'verify-0049: all checks passed';
end $$;

rollback;
