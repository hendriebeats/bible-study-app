-- One-time migration for the Phase 1b flat-schema rewrite.
--
-- Before: lists were a 3-node nesting — `bullet_list` / `ordered_list` /
--   `task_list` wrappers around `list_item` / `task_item` children whose
--   content was `paragraph block*` (a leading paragraph + optional nested
--   lists or other blocks).
-- After:  a single flat `list_row` node carries `listType` ("bullet" /
--   "ordered" / "task"), `indent` (0…15), `checked` (task only), and
--   `listStart` (ordered run-restart). No structural list wrappers. The
--   visual "run" of contiguous same-type rows is a CSS concern, not schema.
--
-- This migration walks every JSONB column where a ProseMirror document
-- (PMDocJSON) can be persisted and, for each list wrapper it finds,
-- inlines its children as flat `list_row` siblings at the corresponding
-- indent, recursively descending into nested lists at indent + 1.
--
-- It also truncates `section_steps` (the append-only step log). The flat
-- schema's incremental step shape is incompatible with the nested-list step
-- shape (a `liftListItem` step in cached history would target node types
-- that no longer carry editing semantics). Section checkpoints (the named
-- snapshots in `section_checkpoints`) are migrated above, so the history
-- timeline keeps its named restores; only the intra-checkpoint undo log is
-- lost. This trade-off was confirmed before the rewrite started.
--
-- Idempotent: re-running is a no-op (the JSONPath guard only matches docs
-- still containing a list wrapper, and that won't be true after one pass).

-- Helper: flatten an item (list_item or task_item) into an array of one
-- list_row + recursively-flattened post-paragraph siblings.
--
-- Args:
--   item         the JSONB node (list_item / task_item)
--   list_type    'bullet' | 'ordered' | 'task' — the parent list's type
--   item_indent  the absolute indent the row should sit at
--   list_start   nullable int — the explicit start value for ordered runs
--                (only set on the first row of an ordered list)
create or replace function pg_temp.flatten_list_item(
  item jsonb,
  list_type text,
  item_indent int,
  list_start int
)
returns jsonb
language plpgsql
immutable
as $$
declare
  out_arr jsonb := '[]'::jsonb;
  inline_content jsonb := '[]'::jsonb;
  i int;
  child jsonb;
  child_type text;
  checked bool;
  row_attrs jsonb;
  row_node jsonb;
  remaining jsonb := '[]'::jsonb;
  remaining_child jsonb;
begin
  checked := coalesce((item->'attrs'->>'checked')::bool, false);

  -- Item content is "paragraph block*": the first paragraph contributes the
  -- row's inline content, every subsequent block becomes a recursively-
  -- flattened sibling.
  for i in 0..coalesce(jsonb_array_length(item->'content'), 0) - 1 loop
    child := item->'content'->i;
    child_type := child->>'type';
    if i = 0 and child_type = 'paragraph' then
      inline_content := coalesce(child->'content', '[]'::jsonb);
    else
      remaining := remaining || jsonb_build_array(child);
    end if;
  end loop;

  row_attrs := jsonb_build_object(
    'indent', item_indent,
    'listType', list_type,
    'checked', checked,
    'listStart', case when list_start is null then 'null'::jsonb
                      else to_jsonb(list_start) end
  );

  row_node := jsonb_build_object(
    'type', 'list_row',
    'attrs', row_attrs,
    'content', inline_content
  );
  out_arr := out_arr || jsonb_build_array(row_node);

  -- Remaining children (nested lists or trailing blocks). Nested lists get
  -- indent + 1 (their children render one level deeper); other blocks stay
  -- at item_indent (they were visually flush with the row).
  for i in 0..coalesce(jsonb_array_length(remaining), 0) - 1 loop
    remaining_child := remaining->i;
    if remaining_child->>'type' in ('bullet_list', 'ordered_list', 'task_list') then
      out_arr := out_arr || pg_temp.flatten_node(remaining_child, item_indent + 1);
    else
      out_arr := out_arr || pg_temp.flatten_node(remaining_child, item_indent);
    end if;
  end loop;

  return out_arr;
end;
$$;

-- Walk a node, returning an array of zero or more replacement siblings.
-- List wrappers expand to their flattened children; every other node passes
-- through with its `content` array recursively walked.
create or replace function pg_temp.flatten_node(j jsonb, base_indent int)
returns jsonb
language plpgsql
immutable
as $$
declare
  out_arr jsonb := '[]'::jsonb;
  type_name text;
  list_type text;
  list_start int;
  item jsonb;
  i int;
  item_self_indent int;
  expanded jsonb := '[]'::jsonb;
begin
  if j is null or jsonb_typeof(j) <> 'object' then
    return jsonb_build_array(j);
  end if;
  type_name := j->>'type';

  -- List wrapper: inline its children as flat list_rows.
  if type_name in ('bullet_list', 'ordered_list', 'task_list') then
    list_type := case type_name
      when 'bullet_list' then 'bullet'
      when 'ordered_list' then 'ordered'
      when 'task_list' then 'task'
    end;
    list_start := nullif(j->'attrs'->>'start', '')::int;
    -- Only ordered_list cares about start; leave bullet/task alone.
    if list_type <> 'ordered' then list_start := null; end if;
    for i in 0..coalesce(jsonb_array_length(j->'content'), 0) - 1 loop
      item := j->'content'->i;
      item_self_indent := coalesce((item->'attrs'->>'indent')::int, 0);
      out_arr := out_arr || pg_temp.flatten_list_item(
        item,
        list_type,
        base_indent + item_self_indent,
        case when i = 0 then list_start else null end
      );
    end loop;
    return out_arr;
  end if;

  -- Orphan list item (defensive — shouldn't happen in a well-formed doc).
  if type_name in ('list_item', 'task_item') then
    return pg_temp.flatten_list_item(
      j,
      case when type_name = 'task_item' then 'task' else 'bullet' end,
      base_indent + coalesce((j->'attrs'->>'indent')::int, 0),
      null
    );
  end if;

  -- Generic recursion: rewrite the node's content array if it has one.
  if j ? 'content' and jsonb_typeof(j->'content') = 'array' then
    for i in 0..jsonb_array_length(j->'content') - 1 loop
      expanded := expanded || pg_temp.flatten_node(j->'content'->i, base_indent);
    end loop;
    return jsonb_build_array(jsonb_set(j, '{content}', expanded));
  end if;

  return jsonb_build_array(j);
end;
$$;

-- For a top-level doc node, flatten_node returns a 1-element array containing
-- the rewritten doc; unwrap to put a single object back in the column.
create or replace function pg_temp.flatten_doc(j jsonb)
returns jsonb
language sql
immutable
as $$
  select pg_temp.flatten_node(j, 0)->0
$$;

-- Primary editor docs (notes + blocks bodies).
update public.documents
set content = pg_temp.flatten_doc(content)
where content @? '$.** ? (@.type == "bullet_list" || @.type == "ordered_list" || @.type == "task_list")';

-- Section history checkpoints.
update public.section_checkpoints
set doc = pg_temp.flatten_doc(doc)
where doc @? '$.** ? (@.type == "bullet_list" || @.type == "ordered_list" || @.type == "task_list")';

-- Per-study editable template blocks.
update public.studies
set template_blocks_doc = pg_temp.flatten_doc(template_blocks_doc)
where template_blocks_doc is not null
  and template_blocks_doc @? '$.** ? (@.type == "bullet_list" || @.type == "ordered_list" || @.type == "task_list")';

-- Genre block templates: default_content is a content fragment (array of
-- block nodes), not a full doc. Wrap as a synthetic doc, walk, unwrap.
update public.genre_block_templates
set default_content = (
  pg_temp.flatten_node(
    jsonb_build_object('type', '__wrap__', 'content', default_content),
    0
  )->0
)->'content'
where default_content is not null
  and default_content @? '$.** ? (@.type == "bullet_list" || @.type == "ordered_list" || @.type == "task_list")';

-- Step log: the incremental nested-list steps are not replayable against the
-- flat schema. Section checkpoints (named snapshots) survive untouched, so
-- the version-history timeline keeps every checkpoint; only intra-checkpoint
-- undo before this migration is lost.
truncate table public.section_steps;
