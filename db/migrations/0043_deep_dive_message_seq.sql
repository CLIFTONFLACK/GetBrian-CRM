-- 0043: a tiebreaker for ordering the Deep Dive Q&A thread.
--
-- addDeepDiveExchange (src/lib/db/queries/deep-dive.ts) inserts a question and
-- its answer in one transaction, so both rows get the same created_at —
-- now() is fixed for the whole transaction. listDeepDiveMessages ordered by
-- created_at alone, which left the pair's order to the planner and could
-- render (and replay to the model) an answer before its question.
--
-- seq is a plain insertion counter. bigserial on an existing table backfills
-- the current rows in physical order, which for an append-only table is
-- insertion order. Idempotent: safe to re-apply.

alter table public.deep_dive_messages
  add column if not exists seq bigserial;

comment on column public.deep_dive_messages.seq is
  'Insertion order — the tiebreaker when two turns share a created_at '
  '(a question and its answer are written in one transaction).';
