-- link_previews: shared OpenGraph cache for the editor's hover-link preview card.
--
-- One row per *normalized* external URL. The server action `fetchLinkPreview`
-- looks up by sha256(url) before fetching upstream; on success it stores the OG
-- meta + favicon for 30 days, on failure (timeout, SSRF block, no OG, 4xx/5xx)
-- for 1 day so flapping sites retry soon. Writes go through the service-role
-- client (server-only); RLS lets any signed-in user read.
create table public.link_previews (
  url_hash text primary key,
  url text not null,
  title text,
  description text,
  image_url text,
  favicon_url text,
  site_name text,
  status text not null check (status in ('ok', 'failed', 'unreachable', 'blocked')),
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Sweepers (future cron) want to find rows past their TTL quickly.
create index link_previews_expires_at_idx on public.link_previews (expires_at);

alter table public.link_previews enable row level security;

-- Any authenticated user can read previews (they're meta-info about public URLs).
create policy "authenticated read link previews"
  on public.link_previews
  for select
  to authenticated
  using (true);

-- No INSERT / UPDATE / DELETE policies: writes are restricted to the service
-- role, which bypasses RLS. The server action is the single writer.

comment on table public.link_previews is
  'Shared OpenGraph metadata cache for the editor''s hover link-preview card. Keyed by sha256 of the normalized URL. Writes via service role only (see fetchLinkPreview server action).';
