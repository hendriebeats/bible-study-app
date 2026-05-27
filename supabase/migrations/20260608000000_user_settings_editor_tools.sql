-- Per-user opt-in editor tools (Phase 2). A jsonb map of tool-key -> boolean,
-- read by the editor to decide which optional tools to surface for the user.
-- Defaults to '{}' so existing rows need no backfill (all tools off).
alter table public.user_settings
  add column if not exists editor_tools jsonb not null default '{}'::jsonb;
