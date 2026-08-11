-- Email engagement tracking for external sends.
--
--   deal_id      — so a deal can show its own outbound history (the wizard can
--                  be opened from a deal, not just a match pair).
--   status +     — updated by POST /api/webhooks/resend, which matches the row
--   *_at stamps    on the already-stored Resend message id (`provider_id`).

alter table public.external_sends
  add column if not exists deal_id      uuid references public.deals(id) on delete set null,
  add column if not exists status       text,
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at    timestamptz,
  add column if not exists clicked_at   timestamptz,
  add column if not exists bounced_at   timestamptz;

create index if not exists external_sends_deal_idx     on public.external_sends(deal_id);
-- The webhook looks rows up by provider id on every event.
create index if not exists external_sends_provider_idx on public.external_sends(provider_id);
