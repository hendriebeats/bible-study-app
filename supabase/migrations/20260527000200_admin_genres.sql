-- ============================================================================
-- Global admin role + genre-based study-block template library.
--
--   * `profiles.is_admin` gates a global admin area (super-admin only) where
--     genre block-templates are authored. Checked via an is_admin() helper in
--     the same SECURITY DEFINER style as the other RLS helpers.
--   * Each study has a `genre`; a study's default study-blocks prefill from that
--     genre's template. Block templates carry a `lineage_id` (the canonical
--     shared slot) so blocks line up across members' studies later.
-- Genres + templates are world-readable (authenticated) and admin-writable.
-- ============================================================================

alter table public.profiles
  add column is_admin boolean not null default false;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------------
-- genres + genre_block_templates
-- ---------------------------------------------------------------------------
create table public.genres (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger genres_set_updated_at
  before update on public.genres
  for each row execute function public.set_updated_at();

create table public.genre_block_templates (
  id uuid primary key default gen_random_uuid(),
  genre_id uuid not null references public.genres (id) on delete cascade,
  label text not null,
  prompt text,
  position integer not null default 0,
  lineage_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index genre_block_templates_genre_idx
  on public.genre_block_templates (genre_id, position);

create trigger genre_block_templates_set_updated_at
  before update on public.genre_block_templates
  for each row execute function public.set_updated_at();

alter table public.studies
  add column genre_id uuid references public.genres (id);

-- ---------------------------------------------------------------------------
-- RLS: everyone authenticated reads; only admins write.
-- ---------------------------------------------------------------------------
alter table public.genres enable row level security;
alter table public.genre_block_templates enable row level security;

create policy "Anyone can read genres"
  on public.genres for select
  to authenticated
  using (true);

create policy "Admins manage genres"
  on public.genres for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Anyone can read genre block templates"
  on public.genre_block_templates for select
  to authenticated
  using (true);

create policy "Admins manage genre block templates"
  on public.genre_block_templates for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Starter seed: genres + a tailored default block set per genre. These are
-- editable in the admin area; the variation by genre is intentional.
-- ---------------------------------------------------------------------------
insert into public.genres (slug, name, description, position) values
  ('narrative',   'Narrative / History', 'Old Testament narrative and historical books.', 0),
  ('gospel',      'Gospel',              'The four Gospels: the life and teaching of Jesus.', 1),
  ('epistle',     'Epistle / Letter',    'New Testament letters.', 2),
  ('wisdom',      'Wisdom / Poetry',     'Psalms, Proverbs, Job, Ecclesiastes, Song of Songs.', 3),
  ('prophecy',    'Prophecy',            'Major and minor prophetic books.', 4),
  ('law',         'Law / Torah',         'The Pentateuch and the Law.', 5),
  ('apocalyptic', 'Apocalyptic',         'Daniel, Revelation, apocalyptic literature.', 6);

-- block templates per genre (label, prompt, position)
insert into public.genre_block_templates (genre_id, label, prompt, position)
select g.id, b.label, b.prompt, b.position
from public.genres g
join (values
  ('narrative', 'Observation',   'What happens? Who is involved, where, and when?', 0),
  ('narrative', 'Characters',    'What do you learn about the people and about God?', 1),
  ('narrative', 'Interpretation','What is the author teaching through this account?', 2),
  ('narrative', 'Application',   'How should this shape my life?', 3),
  ('narrative', 'Prayer',        'Respond to God in prayer.', 4),

  ('gospel', 'Observation',    'What does Jesus say and do here?', 0),
  ('gospel', 'Interpretation', 'What does this reveal about Jesus and the Kingdom?', 1),
  ('gospel', 'Application',    'How does this call me to follow him?', 2),
  ('gospel', 'Prayer',         'Respond to God in prayer.', 3),

  ('epistle', 'Context',     'Who is writing, to whom, and why?', 0),
  ('epistle', 'Argument',    'Trace the flow of the argument.', 1),
  ('epistle', 'Key truths',  'What core truths are taught here?', 2),
  ('epistle', 'Application', 'How should this change how I live?', 3),
  ('epistle', 'Prayer',      'Respond to God in prayer.', 4),

  ('wisdom', 'Imagery',    'What images and figures of speech stand out?', 0),
  ('wisdom', 'Themes',     'What truths about life and God are taught?', 1),
  ('wisdom', 'Reflection', 'How does this passage speak to my heart?', 2),
  ('wisdom', 'Application','How should this shape my life?', 3),
  ('wisdom', 'Prayer',     'Respond to God in prayer.', 4),

  ('prophecy', 'Historical context', 'What was happening when this was written?', 0),
  ('prophecy', 'Message',            'What is God saying to his people?', 1),
  ('prophecy', 'Christ / Fulfillment','How does this point to Christ?', 2),
  ('prophecy', 'Application',        'How should this shape my life?', 3),
  ('prophecy', 'Prayer',             'Respond to God in prayer.', 4),

  ('law', 'Observation',   'What does the text command or describe?', 0),
  ('law', 'Interpretation','What did this mean for Israel, and what does it reveal about God?', 1),
  ('law', 'Christ',        'How is this fulfilled in Christ?', 2),
  ('law', 'Application',   'How should this shape my life?', 3),
  ('law', 'Prayer',        'Respond to God in prayer.', 4),

  ('apocalyptic', 'Observation',   'What images and symbols appear?', 0),
  ('apocalyptic', 'Interpretation','What hope or warning is being conveyed?', 1),
  ('apocalyptic', 'Application',   'How should this shape my life today?', 2),
  ('apocalyptic', 'Prayer',        'Respond to God in prayer.', 3)
) as b(genre_slug, label, prompt, position)
  on b.genre_slug = g.slug;
