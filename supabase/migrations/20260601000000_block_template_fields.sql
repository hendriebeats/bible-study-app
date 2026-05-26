-- ============================================================================
-- Study-block fields rework: title + subtitle + body placeholder + default
-- content (replacing the old label + guiding-question "prompt").
--
--   * genre_block_templates: label -> title; prompt -> placeholder (the old
--     guiding question becomes the empty-body placeholder); add subtitle and a
--     rich-text default_content (jsonb) that pre-fills the block body when a
--     section is seeded from the template.
--   * Materialized study-block snapshots (documents.content for kind='blocks'
--     and section_checkpoints.doc) are rewritten in place so the head docs use
--     the new attr names. The append-only step log (section_steps) is left
--     untouched — the editor tolerates legacy steps and falls back to the
--     (rewritten) head doc if a replay ever fails.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- genre_block_templates columns
-- ---------------------------------------------------------------------------
alter table public.genre_block_templates rename column label to title;
alter table public.genre_block_templates add column subtitle text;
alter table public.genre_block_templates add column placeholder text;
update public.genre_block_templates set placeholder = prompt where prompt is not null;
alter table public.genre_block_templates drop column prompt;
alter table public.genre_block_templates add column default_content jsonb;

-- ---------------------------------------------------------------------------
-- Rewrite stored study_block node attrs (label->title, prompt->placeholder)
-- inside materialized doc snapshots. study_block nodes are top-level children
-- of a blocks document, so we only remap the doc's `content` array.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.remap_study_blocks(_doc jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_set(
    _doc,
    '{content}',
    coalesce(
      (
        select jsonb_agg(
          case
            when elem->>'type' = 'study_block' then
              (elem - 'attrs') || jsonb_build_object(
                'attrs',
                ((elem->'attrs') - 'label' - 'prompt') || jsonb_build_object(
                  'title', coalesce(elem->'attrs'->>'label', elem->'attrs'->>'title', ''),
                  'subtitle', coalesce(elem->'attrs'->>'subtitle', ''),
                  'placeholder', coalesce(elem->'attrs'->>'prompt', elem->'attrs'->>'placeholder', '')
                )
              )
            else elem
          end
          order by ord
        )
        from jsonb_array_elements(_doc->'content') with ordinality as t(elem, ord)
      ),
      '[]'::jsonb
    )
  );
$$;

update public.documents d
set content = pg_temp.remap_study_blocks(d.content)
where d.kind = 'blocks'
  and exists (
    select 1
    from jsonb_array_elements(d.content->'content') e
    where e->>'type' = 'study_block'
      and (e->'attrs' ? 'label' or e->'attrs' ? 'prompt')
  );

update public.section_checkpoints c
set doc = pg_temp.remap_study_blocks(c.doc)
where exists (
    select 1
    from jsonb_array_elements(c.doc->'content') e
    where e->>'type' = 'study_block'
      and (e->'attrs' ? 'label' or e->'attrs' ? 'prompt')
  );
