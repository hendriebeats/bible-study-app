-- ============================================================================
-- Scripture passages (normalized verse-range sidecar) + personal highlights.
--
--   * scripture_passages: the RENDERED raw text lives in a `scripture` node in
--     the section's Notes doc; this table is the normalized metadata sidecar.
--     A packed integer verse id (bookOrdinal*1e6 + chapter*1e3 + verse) makes
--     cross-study verse-range OVERLAP pure indexable integer math (used by the
--     Phase 3 alignment engine), and lets seeding copy passages without
--     re-hitting the ESV API.
--   * document_highlights: a PERSONAL annotation layer kept OUT of the doc/step
--     log (one row per user per document) so highlights never enter version
--     history and are trivially stripped when a study is copied/seeded.
-- ============================================================================

create table public.scripture_passages (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  reference text not null,
  version text not null default 'ESV',
  book text not null,
  book_ordinal smallint not null,
  start_chapter smallint not null,
  start_verse smallint not null,
  end_chapter smallint not null,
  end_verse smallint not null,
  -- packed absolute verse ids for range/overlap math
  start_verse_id integer not null,
  end_verse_id integer not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scripture_passages_section_idx
  on public.scripture_passages (section_id, position);
create index scripture_passages_range_idx
  on public.scripture_passages (start_verse_id, end_verse_id);

create trigger scripture_passages_set_updated_at
  before update on public.scripture_passages
  for each row execute function public.set_updated_at();

alter table public.scripture_passages enable row level security;

create policy "Read passages of readable sections"
  on public.scripture_passages for select
  using (public.can_read_section(section_id));

create policy "Insert passages into own sections"
  on public.scripture_passages for insert
  with check (public.is_section_owner(section_id));

create policy "Update passages of own sections"
  on public.scripture_passages for update
  using (public.is_section_owner(section_id))
  with check (public.is_section_owner(section_id));

create policy "Delete passages of own sections"
  on public.scripture_passages for delete
  using (public.is_section_owner(section_id));

-- ---------------------------------------------------------------------------
-- document_highlights: per-user personal highlights over a document. `ranges`
-- is a jsonb array of { from, to, color } (doc positions, re-mapped client-side
-- through edits). A reader may highlight any document they can read, but only
-- ever sees/edits their OWN highlights.
-- ---------------------------------------------------------------------------
create table public.document_highlights (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  ranges jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, user_id)
);

create trigger document_highlights_set_updated_at
  before update on public.document_highlights
  for each row execute function public.set_updated_at();

alter table public.document_highlights enable row level security;

create policy "Read own highlights on readable documents"
  on public.document_highlights for select
  using (user_id = (select auth.uid()) and public.can_read_document(document_id));

create policy "Insert own highlights on readable documents"
  on public.document_highlights for insert
  with check (user_id = (select auth.uid()) and public.can_read_document(document_id));

create policy "Update own highlights"
  on public.document_highlights for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Delete own highlights"
  on public.document_highlights for delete
  using (user_id = (select auth.uid()));
