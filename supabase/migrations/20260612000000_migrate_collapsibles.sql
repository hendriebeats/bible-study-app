-- One-time migration for the Notion-style collapsible redesign.
--
-- Before: `collapsible` carried its title on a `summary` attribute, with the
--   body content as `block+` children.
-- After:  the FIRST child paragraph IS the header; `summary` is still an
--   allowed attribute (default "") so historical step logs deserialize, but
--   new code never sets it.
--
-- This migration walks every JSONB column where a ProseMirror document
-- (PMDocJSON) can be persisted and, for each `collapsible` node it finds with
-- a non-empty `summary`, prepends a paragraph carrying that text and clears
-- the attribute. Idempotent: re-running it is a no-op (the `summary`
-- non-empty check stops re-processing already-migrated nodes).
--
-- Step logs (`section_steps.step`) are intentionally left alone:
--   * The schema still accepts a default-empty `summary` attribute, so old
--     step JSON parses cleanly.
--   * Step shapes that inserted a collapsible with non-paragraph first child
--     were never produced by `insertCollapsible.createAndFill`, so we don't
--     expect any in production.
-- `sections.content` is the legacy frozen mirror (replaced by `documents`
-- before this redesign shipped) and isn't read by the live editor; leaving it
-- untouched avoids touching dead data.

create or replace function pg_temp.migrate_collapsibles(j jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  result jsonb;
  walked_content jsonb;
  child jsonb;
  i int;
  summary_text text;
begin
  if j is null or jsonb_typeof(j) <> 'object' then
    return j;
  end if;
  result := j;

  -- Walk children first so deeply-nested collapsibles (toggle in callout in
  -- study_block in doc) get migrated bottom-up.
  if result ? 'content' and jsonb_typeof(result->'content') = 'array' then
    walked_content := '[]'::jsonb;
    for i in 0..jsonb_array_length(result->'content') - 1 loop
      child := result->'content'->i;
      walked_content := walked_content
        || jsonb_build_array(pg_temp.migrate_collapsibles(child));
    end loop;
    result := jsonb_set(result, '{content}', walked_content);
  end if;

  -- Transform IF this node is a collapsible with a non-empty summary. The
  -- new shape: prepend a paragraph carrying the title; clear summary.
  if result->>'type' = 'collapsible'
     and result->'attrs' ? 'summary'
     and length(coalesce(result->'attrs'->>'summary', '')) > 0
  then
    summary_text := result->'attrs'->>'summary';
    result := jsonb_set(
      result,
      '{content}',
      jsonb_build_array(
        jsonb_build_object(
          'type', 'paragraph',
          'content', jsonb_build_array(
            jsonb_build_object('type', 'text', 'text', summary_text)
          )
        )
      ) || coalesce(result->'content', '[]'::jsonb)
    );
    result := jsonb_set(result, '{attrs,summary}', '""'::jsonb);
  end if;

  return result;
end;
$$;

-- Primary editor docs (notes + blocks bodies).
update public.documents
set content = pg_temp.migrate_collapsibles(content)
where content @? '$.** ? (@.type == "collapsible")';

-- Section history checkpoints (the table is named `section_checkpoints` and
-- stores the snapshot in `doc`).
update public.section_checkpoints
set doc = pg_temp.migrate_collapsibles(doc)
where doc @? '$.** ? (@.type == "collapsible")';

-- Per-study editable template blocks (seeds new sections).
update public.studies
set template_blocks_doc = pg_temp.migrate_collapsibles(template_blocks_doc)
where template_blocks_doc is not null
  and template_blocks_doc @? '$.** ? (@.type == "collapsible")';

-- Genre block templates: each row's default_content is a content fragment
-- (array of block nodes), not a full doc. Wrap it so the walker enters the
-- array via the same `content` path, then unwrap.
update public.genre_block_templates
set default_content = (
  pg_temp.migrate_collapsibles(jsonb_build_object('content', default_content))
)->'content'
where default_content is not null
  and default_content @? '$.** ? (@.type == "collapsible")';
