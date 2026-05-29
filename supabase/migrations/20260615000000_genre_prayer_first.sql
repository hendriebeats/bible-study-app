-- ============================================================================
-- Genre templates: open every genre with a high-contrast Prayer reminder.
--
-- The study_block schema now carries a `variant` attr — "standard" (the
-- existing titled card with an editable body) and "action" (a high-contrast
-- reminder bar with header + subheader only, no visible body). Genre
-- templates currently end with a `Prayer` block whose placeholder asks the
-- user to write a prayer; we're replacing that with an opening, action-variant
-- Prayer reminder so each genre study begins by framing prayer up front.
--
--   * genre_block_templates gains a `variant` column (default 'standard').
--   * For every genre, drop the trailing 'Prayer' row, shift the remaining
--     rows down one position, and insert a new opening row at position 0 with
--     variant='action', title='Prayer', subtitle='Meet with God.'.
--   * genre_blocks_doc() is updated to emit the variant in each study_block's
--     attrs JSONB so newly-seeded blocks/template_blocks_doc carry it.
--
-- Existing sections + existing studies.template_blocks_doc are intentionally
-- left untouched (the user opted out of backfill): new sections seeded after
-- this migration get the new opener; pre-existing docs do not.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Schema: add the variant discriminator. CHECK keeps unknown values out so
-- the editor never has to defend against a third variant it doesn't render.
-- ---------------------------------------------------------------------------
alter table public.genre_block_templates
  add column variant text not null default 'standard'
  check (variant in ('standard', 'action'));

-- ---------------------------------------------------------------------------
-- 2. Reseed each genre's Prayer step: trailing 'Prayer' row out, opening
-- action-variant 'Prayer' row in (positions shift accordingly). Done in one
-- CTE chain per genre so the position UPDATE never collides with the existing
-- unique-by-(genre_id, position) ordering invariant: delete first, shift
-- second, insert third. Each genre's INSERT uses a fresh lineage_id so the
-- new opener is its own cross-study slot (it doesn't share lineage with the
-- block it's replacing — those are semantically different "write a prayer" vs
-- "step into prayer" prompts).
-- ---------------------------------------------------------------------------
delete from public.genre_block_templates t
using public.genres g
where t.genre_id = g.id
  and g.slug in (
    'narrative', 'gospel', 'epistle', 'wisdom',
    'prophecy', 'law', 'apocalyptic'
  )
  and t.title = 'Prayer';

update public.genre_block_templates t
set position = t.position + 1
from public.genres g
where t.genre_id = g.id
  and g.slug in (
    'narrative', 'gospel', 'epistle', 'wisdom',
    'prophecy', 'law', 'apocalyptic'
  );

insert into public.genre_block_templates
  (genre_id, title, subtitle, placeholder, default_content, position, variant)
select g.id, 'Prayer', 'Meet with God.', null, null, 0, 'action'
from public.genres g
where g.slug in (
  'narrative', 'gospel', 'epistle', 'wisdom',
  'prophecy', 'law', 'apocalyptic'
);

-- ---------------------------------------------------------------------------
-- 3. genre_blocks_doc: emit the variant attr in each study_block. The SQL
-- twin of studyBlockJSON (src/lib/editor/blocks.ts) MUST stay in sync;
-- coalesce against 'standard' so any pre-migration row (or a row authored
-- before this column existed) still produces a valid attr.
-- ---------------------------------------------------------------------------
create or replace function public.genre_blocks_doc(_genre_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'type', 'doc',
    'content', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'type', 'study_block',
            'attrs', jsonb_build_object(
              'title', t.title,
              'subtitle', coalesce(t.subtitle, ''),
              'placeholder', coalesce(t.placeholder, ''),
              'lineageId', t.lineage_id,
              'templateId', t.id,
              'variant', coalesce(t.variant, 'standard')
            ),
            'content', case
              when t.default_content is not null
                and jsonb_typeof(t.default_content) = 'array'
                and jsonb_array_length(t.default_content) > 0
              then t.default_content
              else jsonb_build_array(jsonb_build_object('type', 'paragraph'))
            end
          )
          order by t.position
        )
        from genre_block_templates t
        where t.genre_id = _genre_id
      ),
      jsonb_build_array(jsonb_build_object('type', 'paragraph'))
    )
  );
$$;
