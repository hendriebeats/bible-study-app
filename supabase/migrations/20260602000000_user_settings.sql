-- ============================================================================
-- Per-user app settings.
--
--   * user_settings: a single row per user holding their preferences as jsonb.
--     For now it carries `scripture_options` — the remembered defaults for
--     inserting an ESV passage (verse numbers, footnotes, copyright, Selahs,
--     layout, poetry line breaks, small-caps divine name). Stored as jsonb so
--     the option shape can grow without a migration; the app normalizes any
--     older/partial shape back to defaults on read.
-- ============================================================================

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  scripture_options jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;

create policy "Manage your own settings"
  on public.user_settings for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
