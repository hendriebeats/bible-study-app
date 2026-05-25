-- ============================================================================
-- Section version history + structural soft-delete.
--
--   * Content history: an append-only `section_steps` log (one ProseMirror Step
--     per row, versioned per section) plus periodic full-doc `section_checkpoints`
--     that double as the user-facing version list. `sections.content` stays the
--     materialized current doc; `sections.current_version` is the head counter.
--   * Structural recovery: a two-tier lifecycle on `sections` and `studies` —
--     active -> trashed (`deleted_at`) -> archived (`archived_at`). Archiving
--     hides rows from the frontend but NEVER deletes them.
--
-- See memory/data-model and the approved plan for the full rationale.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Lifecycle + head-version columns.
-- ---------------------------------------------------------------------------
alter table public.sections
  add column current_version integer not null default 0,
  add column deleted_at timestamptz,
  add column archived_at timestamptz;

alter table public.studies
  add column deleted_at timestamptz,
  add column archived_at timestamptz;

-- Trashed-but-not-yet-archived rows: powers both the Trash UI listing and the
-- daily archival scan.
create index sections_trash_idx on public.sections (deleted_at)
  where deleted_at is not null and archived_at is null;
create index studies_trash_idx on public.studies (deleted_at)
  where deleted_at is not null and archived_at is null;

-- ---------------------------------------------------------------------------
-- section_steps: append-only fine-grained history. `version` is the resulting
-- doc version AFTER this step. The unique constraint is the gap-free/monotonic
-- guard (and also indexes the `(section_id, version > N)` resync queries).
-- ---------------------------------------------------------------------------
create table public.section_steps (
  id bigint generated always as identity primary key,
  section_id uuid not null references public.sections (id) on delete cascade,
  version integer not null,
  step jsonb not null,
  client_id text,
  created_at timestamptz not null default now(),
  unique (section_id, version)
);

-- ---------------------------------------------------------------------------
-- section_checkpoints: full-doc snapshots at a known version. These ARE the
-- user-facing "versions" list (label is null for automatic checkpoints, set
-- for user-named ones). They bound how far history ever has to be replayed.
-- ---------------------------------------------------------------------------
create table public.section_checkpoints (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  version integer not null,
  doc jsonb not null,
  label text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (section_id, version)
);

create index section_checkpoints_section_version_desc_idx
  on public.section_checkpoints (section_id, version desc);

-- ============================================================================
-- Security-definer helpers (same pattern as init.sql: run as owner, bypassing
-- RLS inside so policies can join other tables without recursion).
-- ============================================================================

-- Tighten study readability: archived studies are invisible to end users.
create or replace function public.can_read_study(_study_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from studies s
    where s.id = _study_id
      and s.archived_at is null
      and (s.owner_id = auth.uid() or public.shares_group_with_study(s.id))
  );
$$;

-- May the current user read this section? Hidden if the section or its study is
-- archived; otherwise defers to study readability.
create or replace function public.can_read_section(_section_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from sections sec
    where sec.id = _section_id
      and sec.archived_at is null
      and public.can_read_study(sec.study_id)
  );
$$;

-- Does the current user own the section's study?
create or replace function public.is_section_owner(_section_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from sections sec
    where sec.id = _section_id
      and public.is_study_owner(sec.study_id)
  );
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.section_steps enable row level security;
alter table public.section_checkpoints enable row level security;

-- Reads follow section readability; writes are owner-only (though normal writes
-- go through the SECURITY DEFINER RPCs below). Append-only: no UPDATE/DELETE.
create policy "Read steps of readable sections"
  on public.section_steps for select
  using (public.can_read_section(section_id));

create policy "Insert steps into own sections"
  on public.section_steps for insert
  with check (public.is_section_owner(section_id));

create policy "Read checkpoints of readable sections"
  on public.section_checkpoints for select
  using (public.can_read_section(section_id));

create policy "Insert checkpoints into own sections"
  on public.section_checkpoints for insert
  with check (public.is_section_owner(section_id));

-- Replace the study/section read policies so that: archived rows are invisible
-- to everyone, and trashed rows stay visible to the OWNER (for the Trash UI)
-- but are hidden from group co-members.
drop policy "Read own studies or group co-members' studies" on public.studies;
create policy "Read own studies or group co-members' studies"
  on public.studies for select
  using (
    archived_at is null
    and (
      owner_id = (select auth.uid())
      or (public.shares_group_with_study(id) and deleted_at is null)
    )
  );

drop policy "Read sections of readable studies" on public.sections;
create policy "Read sections of readable studies"
  on public.sections for select
  using (
    archived_at is null
    and (
      public.is_study_owner(study_id)
      or (public.can_read_study(study_id) and deleted_at is null)
    )
  );

-- ============================================================================
-- RPCs (SECURITY DEFINER; each re-checks ownership and raises on failure).
-- ============================================================================

-- Append a batch of steps atomically. `_steps` is a JSON array of serialized
-- ProseMirror steps. Locks the section row to serialize concurrent writers
-- (e.g. the same owner in two tabs); rejects when the client's base version no
-- longer matches the head so the client can resync. Returns the new head.
create or replace function public.append_section_steps(
  _section_id uuid,
  _expected_base integer,
  _steps jsonb,
  _new_doc jsonb,
  _client_id text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _current integer;
  _count integer;
begin
  if not public.is_section_owner(_section_id) then
    raise exception 'not authorized to edit section %', _section_id
      using errcode = '42501';
  end if;

  -- Lock the head; serializes concurrent appends for this section.
  select current_version into _current
  from sections
  where id = _section_id
  for update;

  if _current is null then
    raise exception 'section % not found', _section_id using errcode = 'P0002';
  end if;

  -- Optimistic concurrency: the batch must build on the current head.
  if _expected_base <> _current then
    raise exception 'version conflict: expected base %, head is %',
      _expected_base, _current using errcode = '40001';
  end if;

  _count := coalesce(jsonb_array_length(_steps), 0);

  if _count > 0 then
    insert into section_steps (section_id, version, step, client_id)
    select _section_id, (_current + t.ord)::integer, t.elem, _client_id
    from jsonb_array_elements(_steps) with ordinality as t(elem, ord);
  end if;

  update sections
  set content = _new_doc,
      current_version = _current + _count
  where id = _section_id;

  return _current + _count;
end;
$$;

-- Snapshot the current doc as a checkpoint (idempotent per version).
create or replace function public.create_section_checkpoint(
  _section_id uuid,
  _label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _version integer;
  _doc jsonb;
  _checkpoint_id uuid;
begin
  if not public.is_section_owner(_section_id) then
    raise exception 'not authorized to checkpoint section %', _section_id
      using errcode = '42501';
  end if;

  select current_version, content into _version, _doc
  from sections
  where id = _section_id;

  if _version is null then
    raise exception 'section % not found', _section_id using errcode = 'P0002';
  end if;

  insert into section_checkpoints (section_id, version, doc, label, created_by)
  values (_section_id, _version, _doc, _label, auth.uid())
  on conflict (section_id, version) do update
    set label = coalesce(excluded.label, section_checkpoints.label)
  returning id into _checkpoint_id;

  return _checkpoint_id;
end;
$$;

-- Daily archival: hide trash older than 30 days WITHOUT deleting it. Runs as a
-- definer so it bypasses RLS; never issues a DELETE.
create or replace function public.archive_expired_trash()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.studies
  set archived_at = now()
  where deleted_at is not null
    and archived_at is null
    and deleted_at < now() - interval '30 days';

  update public.sections
  set archived_at = now()
  where deleted_at is not null
    and archived_at is null
    and deleted_at < now() - interval '30 days';
end;
$$;

-- Schedule the archival job via pg_cron. Wrapped so a local environment without
-- pg_cron preloaded (shared_preload_libraries) doesn't fail `db reset`; on
-- Supabase (pg_cron preloaded) this registers/updates the job. Verify it exists
-- in production: select * from cron.job;
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'archive-expired-trash',
    '0 3 * * *',
    'select public.archive_expired_trash();'
  );
exception
  when others then
    raise notice 'pg_cron unavailable (%); schedule archive_expired_trash() manually in production.', sqlerrm;
end;
$$;
