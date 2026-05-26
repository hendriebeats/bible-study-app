-- ============================================================================
-- Recently-used formatting actions for the selection bubble's quick action.
--
-- Adds `format_recents` to the per-user settings row: a small most-recently-used
-- list of formatting choices (apply a given highlight/text colour, or toggle a
-- mark) so re-applying "highlight green" / "text blue" is one click. Stored as
-- jsonb (object-wrapped, like `scripture_options`) so the shape can grow without
-- a migration; the app normalizes any older/partial/untrusted shape on read.
-- Existing RLS ("Manage your own settings") already covers this column.
-- ============================================================================

alter table public.user_settings
  add column format_recents jsonb not null default '{}'::jsonb;
