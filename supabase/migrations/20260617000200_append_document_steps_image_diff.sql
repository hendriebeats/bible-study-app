-- ============================================================================
-- Extend `append_document_steps` with image-src reference counting.
--
-- The RPC now also:
--   1. Accepts `_new_image_src_index text[]` — the set of image-node `src`
--      URLs present in `_new_doc` (computed client-side by walking the doc).
--   2. Computes `removed = previous.image_src_index − _new_image_src_index`
--      atomically with the row update (so two concurrent saves see a
--      consistent before/after pair).
--   3. Overwrites `documents.image_src_index` with `_new_image_src_index`.
--   4. Returns BOTH the new head version AND the `removed` array, so the
--      client can `move` orphaned files into the study-images `_trash/`
--      subpath (the 30-day-retention soft delete).
--
-- Return type changes from `integer` to `TABLE(new_version int,
-- removed_srcs text[])` — callers updated alongside this migration.
--
-- A null/empty `_new_image_src_index` is treated as "no image nodes in the
-- new doc"; if the document didn't previously hold any images either, this is
-- a no-op for the cleanup branch.
-- ============================================================================

drop function if exists public.append_document_steps(uuid, integer, jsonb, jsonb, text, integer[]);

create or replace function public.append_document_steps(
  _document_id uuid,
  _expected_base integer,
  _steps jsonb,
  _new_doc jsonb,
  _client_id text default null,
  _boundaries integer[] default null,
  _new_image_src_index text[] default null
)
returns table(new_version integer, removed_srcs text[])
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
  _old_index text[];
  _new_index text[];
  _removed text[];
begin
  if not public.is_document_owner(_document_id) then
    raise exception 'not authorized to edit document %', _document_id
      using errcode = '42501';
  end if;

  select current_version, content, section_id, image_src_index
    into _current, _old_doc, _section_id, _old_index
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
  _new_index := coalesce(_new_image_src_index, array[]::text[]);
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

  -- Reference-count diff: srcs in the old index but not the new are orphans.
  -- ARRAY(... EXCEPT ...) preserves uniqueness without requiring sorted input.
  select coalesce(array_agg(s), array[]::text[]) into _removed
  from (
    select unnest(_old_index)
    except
    select unnest(_new_index)
  ) as t(s);

  update documents
  set content = _new_doc,
      current_version = _current + _count,
      image_src_index = _new_index
  where id = _document_id;

  update sections set updated_at = now() where id = _section_id;

  new_version := _current + _count;
  removed_srcs := _removed;
  return next;
end;
$$;
