-- 0048: Didit webhook — a signing secret per agency, and an ordering stamp on
-- each identity check.
--
-- 1. agency_settings.didit_webhook_secret
--    Didit calls POST /api/webhooks/didit/<agency id> when an identity check
--    changes status. Each agency has its own Didit account, so each one has its
--    own webhook destination and its own signing secret. The route uses this
--    column to check the HMAC signature on each delivery.
--
--    The secret is entered on the Admin page next to the Didit API key, with the
--    same write-only rule: a blank field keeps the saved value, and the value is
--    never sent back to the browser. "Remove key" clears it as well.
--
--    A NULL secret means the webhook is off for that agency: the route refuses
--    every delivery, and the "Refresh" button stays the only way to update.
--
-- 2. didit_sessions.decision_fetched_at
--    When the saved decision was fetched from Didit. Two deliveries for one
--    check can arrive close together, and each one fetches the decision again.
--    The fetch that started later sees the newer state, but it can finish
--    first. A save is skipped when the row already holds a decision fetched
--    later, so an older state never overwrites a newer one.
--
-- DEPLOY ORDER
-- Apply this migration BEFORE the code goes live. getAgencySettings selects
-- the new settings column, so the Admin page and every Didit action fail
-- without it. Both statements are idempotent.

alter table public.agency_settings
  add column if not exists didit_webhook_secret text;

alter table public.didit_sessions
  add column if not exists decision_fetched_at timestamptz;
