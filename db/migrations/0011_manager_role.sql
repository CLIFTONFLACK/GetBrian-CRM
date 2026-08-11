-- Upgrades batch — Phase 0
-- (1) Add a third member role 'manager' (sits between admin and agent in intent;
--     the app treats admin+manager as elevated for nav/visibility).
-- (2) Marketing-consent flag on contacts (#14: "approves marketing communications").
--
-- NOTE: a new enum value cannot be USED in the same transaction that adds it, so
-- the 2 manager users are seeded separately (supabase/seeds/dummy_managers.sql),
-- which runs after this migration has committed.

alter type public.member_role add value if not exists 'manager';

alter table public.contacts
  add column if not exists marketing_opt_in boolean not null default false;
