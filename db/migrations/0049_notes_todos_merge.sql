-- 0049: notes and to-dos become one thing.
--
-- WHY
-- A note (public.activities) belongs to a record and has no owner or due date.
-- A to-do (public.tasks) has an assignee and a due date. A deal reminder
-- (public.deal_reminders) is a third copy of the same idea, for deals only. The
-- panels showed them on separate tabs. From now on there is one list per
-- record: a note can be given an assignee and a due date, and then it is a
-- to-do.
--
-- MODEL
-- A to-do is an activity whose `status` is not null ('open' or 'done'). A plain
-- note has status null. The assignee and the due date are optional on a to-do.
-- A check keeps this honest: an assignee or a due date needs a status.
--
-- New columns on public.activities (all nullable, no defaults except updated_at):
--   assignee_id   who must do it
--   due_at        when
--   status        null = a note, 'open' / 'done' = a to-do
--   completed_at  when it was ticked
--   completed_by  who ticked it
--   notified_at   stamped by the due-date cron so each to-do notifies once
--   updated_at    set by trigger (public.set_updated_at)
--
-- DATA MOVE (the old tables are kept, untouched, for one release as the way back)
--   public.tasks          -> activities (type 'task'), same id, same status,
--                            assignee, due date and notified_at
--   public.deal_reminders -> activities on the deal (type 'task'), same id.
--                            Assignee = the deal's lead agent, else its creator,
--                            else the reminder's creator (the cron used the same order)
-- The move is keyed on id, so running the file again adds no duplicates. It is
-- meant to be run a second time, once, right after the new code is deployed, to
-- pick up what the old code wrote in between: new tasks and reminders, and the
-- notified_at stamps (see the conflict clauses). Do NOT run it again later: the
-- old tables still hold every row, so an entry deleted in the new screen would
-- come back.
--
-- ORPHANS
-- activities.entity_id has no foreign key (it points at five tables), so deleting
-- a company, contact, requirement, listing or deal left its notes behind. Delete
-- triggers, in the style of 0045, remove them.
--
-- DEPLOY ORDER
-- Apply this migration BEFORE the code that reads the new columns goes live. Old
-- code against the new schema is safe: it never selects the new columns.
--
-- Idempotent: safe to run twice. No begin/commit here; the runner wraps the file.

alter table public.activities add column if not exists assignee_id  uuid references public.users(id) on delete set null;
alter table public.activities add column if not exists due_at       timestamptz;
alter table public.activities add column if not exists status       text;
alter table public.activities add column if not exists completed_at timestamptz;
alter table public.activities add column if not exists completed_by uuid references public.users(id) on delete set null;
alter table public.activities add column if not exists notified_at  timestamptz;
alter table public.activities add column if not exists updated_at   timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activities_status_check') then
    alter table public.activities
      add constraint activities_status_check check (status is null or status in ('open', 'done'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'activities_todo_has_status_check') then
    alter table public.activities
      add constraint activities_todo_has_status_check
      check ((assignee_id is null and due_at is null) or status is not null);
  end if;
end $$;

create index if not exists activities_assignee_status_idx
  on public.activities(assignee_id, status, due_at) where status is not null;
create index if not exists activities_agency_todo_due_idx
  on public.activities(agency_id, status, due_at) where status is not null;
-- The orphan-cleanup triggers below delete by (entity_type, entity_id) with no
-- agency id, which the (agency_id, entity_type, entity_id) index cannot serve.
create index if not exists activities_entity_only_idx
  on public.activities(entity_type, entity_id);

do $$ begin
  create trigger trg_activities_updated before update on public.activities
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Orphan cleanup: delete a record's notes and to-dos with the record
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.delete_entity_activities() returns trigger
language plpgsql as $$
begin
  delete from public.activities
  where entity_type = tg_argv[0]::public.entity_type and entity_id = old.id;
  return old;
end
$$;

do $$ begin
  create trigger trg_companies_delete_activities after delete on public.companies
    for each row execute function public.delete_entity_activities('company');
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_contacts_delete_activities after delete on public.contacts
    for each row execute function public.delete_entity_activities('contact');
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_requirements_delete_activities after delete on public.requirements
    for each row execute function public.delete_entity_activities('requirement');
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_disposals_delete_activities after delete on public.disposals
    for each row execute function public.delete_entity_activities('listing');
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_deals_delete_activities after delete on public.deals
    for each row execute function public.delete_entity_activities('deal');
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Data move: tasks -> activities
-- ─────────────────────────────────────────────────────────────────────────────
-- tasks.entity_type is free text; only the five known values become a record
-- link, anything else becomes a to-do with no record.
insert into public.activities (
  id, agency_id, type, subject, body, entity_type, entity_id,
  occurred_at, created_by, created_at,
  assignee_id, due_at, status, completed_at, notified_at, updated_at
)
select
  t.id, t.agency_id, 'task', t.title, t.details,
  case when t.entity_type in ('company', 'contact', 'requirement', 'listing', 'deal')
       then t.entity_type::public.entity_type end,
  case when t.entity_type in ('company', 'contact', 'requirement', 'listing', 'deal')
       then t.entity_id end,
  t.created_at, t.created_by, t.created_at,
  t.assignee_id, t.due_at, t.status,
  case when t.status = 'done' then t.updated_at end,
  t.notified_at, t.updated_at
from public.tasks t
-- A second run (right after the deploy) must not lose what the old code did
-- in the gap: a notification it already sent, or a task changed in the old
-- screen. The other fields are taken from the old row only when it is newer than
-- the copy, so a change made in the new screen is never overwritten. The sent
-- stamp is merged only while the due time is unchanged: a new due time cleared
-- the stamp on purpose, and it must not come back.
on conflict (id) do update set
  notified_at  = case
                   when excluded.updated_at > public.activities.updated_at then excluded.notified_at
                   when public.activities.due_at is not distinct from excluded.due_at
                     then coalesce(public.activities.notified_at, excluded.notified_at)
                   else public.activities.notified_at
                 end,
  status       = case when excluded.updated_at > public.activities.updated_at then excluded.status       else public.activities.status       end,
  completed_at = case when excluded.updated_at > public.activities.updated_at then excluded.completed_at else public.activities.completed_at end,
  due_at       = case when excluded.updated_at > public.activities.updated_at then excluded.due_at       else public.activities.due_at       end,
  assignee_id  = case when excluded.updated_at > public.activities.updated_at then excluded.assignee_id  else public.activities.assignee_id  end,
  subject      = case when excluded.updated_at > public.activities.updated_at then excluded.subject      else public.activities.subject      end,
  body         = case when excluded.updated_at > public.activities.updated_at then excluded.body         else public.activities.body         end;

-- ─────────────────────────────────────────────────────────────────────────────
-- Data move: deal_reminders -> activities on the deal
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.activities (
  id, agency_id, type, subject, body, entity_type, entity_id,
  occurred_at, created_by, created_at,
  assignee_id, due_at, status, completed_at, notified_at, updated_at
)
select
  r.id, r.agency_id, 'task', r.title, null, 'deal', r.deal_id,
  r.created_at, r.created_by, r.created_at,
  coalesce(d.lead_agent_id, d.created_by, r.created_by), r.due_at,
  case when r.done then 'done' else 'open' end,
  case when r.done then now() end,
  r.notified_at, now()
from public.deal_reminders r
join public.deals d on d.id = r.deal_id
-- Reminders have no updated_at, so only the sent-notification stamp is merged
-- on a second run, and only while the due time is unchanged. A reminder ticked
-- in the old screen during the gap is not carried over.
on conflict (id) do update set
  notified_at = case
                  when public.activities.due_at is not distinct from excluded.due_at
                    then coalesce(public.activities.notified_at, excluded.notified_at)
                  else public.activities.notified_at
                end;

comment on table public.tasks is
  'Superseded by public.activities (0049). Kept for one release as a way back; no code reads or writes it.';
comment on table public.deal_reminders is
  'Superseded by public.activities (0049). Kept for one release as a way back; no code reads or writes it.';
