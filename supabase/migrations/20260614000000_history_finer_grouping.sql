-- Finer version-history "moments" + a larger window for "long ago" scrubbing.
--
-- Before: every step in one autosave batch shared a single `created_at`, so
-- the history scrubber surfaced one moment per ~1.2s save batch. That made
-- the timeline far coarser than Cmd-Z (which groups at word/action boundaries
-- via `withUndoBoundary`). The legacy 1000-row cap on the moments RPC also
-- meant ~20min of continuous editing hid the older state from the UI.
--
-- This migration:
--   1. Extends `append_document_steps` with an optional `_boundaries int[]` —
--      0-indexed positions inside `_steps` where a NEW group starts. Steps
--      within one group share a `created_at`; each group is staggered by
--      1ms so the existing `GROUP BY created_at` in document_history_moments
--      naturally returns one row per word/action group. Backward compatible:
--      a null/empty array keeps the old "one moment per batch" behaviour.
--   2. Bumps the moment-list cap from 1000 → 50000 (decades of normal use)
--      and adds an explicit `_limit` param so the client can opt into a
--      smaller window if it ever needs to.
--
-- No data backfill: existing rows keep their single `created_at` per batch
-- (one moment each), which is exactly what users see today; only NEW edits
-- get the finer grouping.

-- Drop the pre-existing function signatures explicitly: `create or replace`
-- on a function with a NEW parameter would create an overload alongside the
-- old function, leaving ambiguous-call errors at runtime. Drop-then-create is
-- the only way to truly replace the signature.
drop function if exists public.append_document_steps(uuid, integer, jsonb, jsonb, text);
drop function if exists public.document_history_moments(uuid);

create or replace function public.append_document_steps(
  _document_id uuid,
  _expected_base integer,
  _steps jsonb,
  _new_doc jsonb,
  _client_id text default null,
  _boundaries integer[] default null
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
  _bnd integer[];
  _now timestamptz;
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
  _bnd := coalesce(_boundaries, array[]::integer[]);
  _now := now();

  if _count > 0 then
    -- For each step at 0-based index i, the group index = number of boundary
    -- entries <= i. Boundary entries at 0 are harmless (group 0 either way).
    -- Steps in the same group share `created_at`; groups are 1ms apart so the
    -- existing GROUP BY created_at moments query returns one row per group.
    insert into section_steps (section_id, document_id, version, step, client_id, created_at)
    select
      _section_id,
      _document_id,
      (_current + t.ord)::integer,
      t.elem,
      _client_id,
      _now + (
        (select count(*) from unnest(_bnd) b where b <= (t.ord - 1)::integer)
        * interval '1 millisecond'
      )
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

-- Lightweight version-history "moments" for a document: one row per group
-- (steps sharing a `created_at` after `append_document_steps`'s per-group
-- stagger), newest first. Defaults to 50000 rows (decades of normal use);
-- callers can pass a smaller `_limit` for a tighter window.
create or replace function public.document_history_moments(
  _document_id uuid,
  _limit integer default 50000
)
returns table(version integer, created_at timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.can_read_document(_document_id) then
    raise exception 'not authorized to read document %', _document_id
      using errcode = '42501';
  end if;
  return query
    select max(s.version)::integer as version, s.created_at
    from section_steps s
    where s.document_id = _document_id
    group by s.created_at
    order by s.created_at desc
    limit greatest(coalesce(_limit, 50000), 1);
end;
$$;
