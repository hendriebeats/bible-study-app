-- ============================================================================
-- Generalize per-section content into a `documents` concept.
--
-- A section used to BE one ProseMirror doc (sections.content + current_version,
-- with section_steps / section_checkpoints keyed on section_id). To support a
-- main "Notes" doc AND a "Study blocks" doc per section -- each independently
-- versioned, real-time, and dockable -- we introduce `documents` and re-key the
-- whole durable history engine onto a generic `document_id`.
--
-- Migration safety:
--   * Additive + backfilled in one transaction (apply_migration wraps in a txn).
--   * `documents.content` becomes the source of truth; `sections.content` /
--     `sections.current_version` are left as a frozen snapshot (rollback hatch).
--   * `section_steps.section_id` / `section_checkpoints.section_id` are kept but
--     made NULLABLE (rollback hatch); the new unique key is (document_id,version)
--     because notes & blocks share a section_id with independent versions.
-- See the approved plan + memory/data-model for rationale.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- documents: one row per (section, kind). A section owns a 'notes' doc and a
-- 'blocks' doc. Default content is a single paragraph (a valid minimal doc the
-- editor can start from, so step replay reconstructs it -- same rule as sections).
-- ---------------------------------------------------------------------------
create type public.document_kind as enum ('notes', 'blocks');

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  kind public.document_kind not null,
  content jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  current_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (section_id, kind)
);

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- Backfill: every existing section's content + head version becomes its 'notes'
-- document; an empty 'blocks' document is created alongside.
insert into public.documents (section_id, kind, content, current_version)
select s.id, 'notes', s.content, s.current_version
from public.sections s;

insert into public.documents (section_id, kind, content, current_version)
select s.id, 'blocks', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb, 0
from public.sections s;

-- ---------------------------------------------------------------------------
-- Re-key history onto document_id. All existing history is Notes history.
-- ---------------------------------------------------------------------------
alter table public.section_steps
  add column document_id uuid references public.documents (id) on delete cascade;
alter table public.section_checkpoints
  add column document_id uuid references public.documents (id) on delete cascade;

update public.section_steps ss
set document_id = d.id
from public.documents d
where d.section_id = ss.section_id and d.kind = 'notes';

update public.section_checkpoints sc
set document_id = d.id
from public.documents d
where d.section_id = sc.section_id and d.kind = 'notes';

-- Guard the backfill: no orphan history rows may remain.
do $$
begin
  if exists (select 1 from public.section_steps where document_id is null)
     or exists (select 1 from public.section_checkpoints where document_id is null) then
    raise exception 'documents backfill left orphan history rows';
  end if;
end;
$$;

-- The new gap-free/monotonic guard is per-document (notes & blocks share a
-- section_id but version independently, so the old (section_id, version) key
-- must go). Keep section_id as a nullable rollback hatch.
alter table public.section_steps drop constraint section_steps_section_id_version_key;
alter table public.section_checkpoints drop constraint section_checkpoints_section_id_version_key;

alter table public.section_steps alter column section_id drop not null;
alter table public.section_checkpoints alter column section_id drop not null;

alter table public.section_steps
  add constraint section_steps_document_id_version_key unique (document_id, version);
alter table public.section_checkpoints
  add constraint section_checkpoints_document_id_version_key unique (document_id, version);

create index section_checkpoints_document_version_desc_idx
  on public.section_checkpoints (document_id, version desc);

-- ============================================================================
-- Security-definer helpers (resolve document -> section, then defer to the
-- existing section helpers; same non-recursive pattern as section_history.sql).
-- ============================================================================
create or replace function public.can_read_document(_document_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from documents d
    where d.id = _document_id and public.can_read_section(d.section_id)
  );
$$;

create or replace function public.is_document_owner(_document_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from documents d
    where d.id = _document_id and public.is_section_owner(d.section_id)
  );
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.documents enable row level security;

-- Policies check the PARENT section directly (via the row's section_id column),
-- mirroring how sections check study_id -- avoids self-referential RLS.
create policy "Read documents of readable sections"
  on public.documents for select
  using (public.can_read_section(section_id));

create policy "Insert documents into own sections"
  on public.documents for insert
  with check (public.is_section_owner(section_id));

create policy "Update documents of own sections"
  on public.documents for update
  using (public.is_section_owner(section_id))
  with check (public.is_section_owner(section_id));

-- Re-point the append-only history policies onto document readability/ownership
-- (document_id is now always present; normal writes go through the RPCs below).
drop policy "Read steps of readable sections" on public.section_steps;
create policy "Read steps of readable documents"
  on public.section_steps for select
  using (public.can_read_document(document_id));

drop policy "Insert steps into own sections" on public.section_steps;
create policy "Insert steps into own documents"
  on public.section_steps for insert
  with check (public.is_document_owner(document_id));

drop policy "Read checkpoints of readable sections" on public.section_checkpoints;
create policy "Read checkpoints of readable documents"
  on public.section_checkpoints for select
  using (public.can_read_document(document_id));

drop policy "Insert checkpoints into own sections" on public.section_checkpoints;
create policy "Insert checkpoints into own documents"
  on public.section_checkpoints for insert
  with check (public.is_document_owner(document_id));

-- ============================================================================
-- RPCs (document-keyed clones of the section RPCs; keep the PT409 convention).
-- ============================================================================

-- Append a batch of steps atomically to a document. Locks the document head to
-- serialize concurrent writers; rejects a stale base with PT409 (-> HTTP 409)
-- so the client resyncs. Populates section_id too (rollback hatch / traceability)
-- and touches the parent section's updated_at to preserve "edited recently".
create or replace function public.append_document_steps(
  _document_id uuid,
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
  _old_doc jsonb;
  _count integer;
  _section_id uuid;
begin
  if not public.is_document_owner(_document_id) then
    raise exception 'not authorized to edit document %', _document_id
      using errcode = '42501';
  end if;

  select current_version, content, section_id
    into _current, _old_doc, _section_id
  from documents
  where id = _document_id
  for update;

  if _current is null then
    raise exception 'document % not found', _document_id using errcode = 'P0002';
  end if;

  if _expected_base <> _current then
    raise exception 'version conflict: expected base %, head is %',
      _expected_base, _current using errcode = 'PT409';
  end if;

  -- On a document's first edit, snapshot the base doc as a checkpoint so history
  -- can always be reconstructed from version 0.
  if not exists (select 1 from section_checkpoints where document_id = _document_id) then
    insert into section_checkpoints (section_id, document_id, version, doc, created_by)
    values (_section_id, _document_id, _current, _old_doc, auth.uid());
  end if;

  _count := coalesce(jsonb_array_length(_steps), 0);

  if _count > 0 then
    insert into section_steps (section_id, document_id, version, step, client_id)
    select _section_id, _document_id, (_current + t.ord)::integer, t.elem, _client_id
    from jsonb_array_elements(_steps) with ordinality as t(elem, ord);
  end if;

  update documents
  set content = _new_doc,
      current_version = _current + _count
  where id = _document_id;

  update sections set updated_at = now() where id = _section_id;

  return _current + _count;
end;
$$;

-- Snapshot a document's current doc as a checkpoint (idempotent per version).
create or replace function public.create_document_checkpoint(
  _document_id uuid,
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
  _section_id uuid;
  _checkpoint_id uuid;
begin
  if not public.is_document_owner(_document_id) then
    raise exception 'not authorized to checkpoint document %', _document_id
      using errcode = '42501';
  end if;

  select current_version, content, section_id into _version, _doc, _section_id
  from documents
  where id = _document_id;

  if _version is null then
    raise exception 'document % not found', _document_id using errcode = 'P0002';
  end if;

  insert into section_checkpoints (section_id, document_id, version, doc, label, created_by)
  values (_section_id, _document_id, _version, _doc, _label, auth.uid())
  on conflict (document_id, version) do update
    set label = coalesce(excluded.label, section_checkpoints.label)
  returning id into _checkpoint_id;

  return _checkpoint_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backwards-compatible shims: the old section-keyed RPCs now delegate to the
-- section's 'notes' document. Kept for one release so any caller not yet moved
-- to the *_document_* RPCs keeps working.
-- ---------------------------------------------------------------------------
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
  _document_id uuid;
begin
  select id into _document_id
  from documents where section_id = _section_id and kind = 'notes';

  if _document_id is null then
    raise exception 'no notes document for section %', _section_id using errcode = 'P0002';
  end if;

  return public.append_document_steps(_document_id, _expected_base, _steps, _new_doc, _client_id);
end;
$$;

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
  _document_id uuid;
begin
  select id into _document_id
  from documents where section_id = _section_id and kind = 'notes';

  if _document_id is null then
    raise exception 'no notes document for section %', _section_id using errcode = 'P0002';
  end if;

  return public.create_document_checkpoint(_document_id, _label);
end;
$$;
