-- ============================================================================
-- Per-study editable template.
--
-- A study now carries `template_blocks_doc` — an owner-curated default block set
-- (a blocks-doc PMDocJSON, the exact shape produced by `genre_blocks_doc` /
-- src/lib/editor/blocks.ts `blocksDocFromSpecs`). It seeds every NEW section's
-- blocks document. NULL means "not set; lazily derive from the source template /
-- genre" (the server action falls back to getStudyTemplateBlockSpecs).
--
--   * studies.template_blocks_doc  — the new column.
--   * seed_section_blocks(section) — copy the study's template into a new
--     section's blocks doc (called from createSection).
--   * the four creation RPCs are re-defined to set template_blocks_doc at study
--     creation so the Template tab is pre-populated and (for template studies)
--     an admin's edits propagate to studies created from them.
-- ============================================================================

alter table public.studies add column if not exists template_blocks_doc jsonb;

-- ---------------------------------------------------------------------------
-- seed_section_blocks: copy the parent study's template_blocks_doc (or its
-- genre default) into the section's blocks document. No-op (leaves the blank
-- paragraph the sections trigger created) when there's no template with blocks.
-- Runs at section creation, BEFORE the editor mounts, so current_version stays 0.
-- ---------------------------------------------------------------------------
create or replace function public.seed_section_blocks(_section_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _study_id uuid;
  _genre_id uuid;
  _tmpl jsonb;
  _doc jsonb;
begin
  if not public.is_section_owner(_section_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select s.study_id, st.template_blocks_doc, st.genre_id
    into _study_id, _tmpl, _genre_id
  from sections s
  join studies st on st.id = s.study_id
  where s.id = _section_id;

  if _study_id is null then
    return;
  end if;

  _doc := coalesce(
    _tmpl,
    case when _genre_id is not null then public.genre_blocks_doc(_genre_id) end
  );

  -- Only seed when the resolved template actually has blocks (else leave the
  -- blank paragraph). @> tests array containment of a study_block element.
  if _doc is not null
     and _doc -> 'content' @> '[{"type":"study_block"}]'::jsonb then
    update documents
      set content = _doc, current_version = 0
    where section_id = _section_id and kind = 'blocks';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- instantiate_study_from_template: now also seeds the new study's
-- template_blocks_doc from the template study's own template (preferred), else
-- its first-section blocks, else its genre default — so a template author's
-- Template-tab edits propagate to studies created from the template.
-- ---------------------------------------------------------------------------
create or replace function public.instantiate_study_from_template(
  _template_study_id uuid,
  _title text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _src studies;
  _tmpl_id uuid;
  _new_study_id uuid;
  _sec record;
  _new_section_id uuid;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into _src from studies where id = _template_study_id;
  if _src.id is null then
    raise exception 'no such template' using errcode = 'P0002';
  end if;

  select id into _tmpl_id
  from study_templates where template_study_id = _template_study_id
  limit 1;

  insert into studies (owner_id, title, genre_id, source_template_id)
  values (
    _uid,
    coalesce(nullif(btrim(_title), ''), _src.title),
    _src.genre_id,
    _tmpl_id
  )
  returning id into _new_study_id;

  update studies set template_blocks_doc = coalesce(
    _src.template_blocks_doc,
    (
      select d.content
      from documents d
      join sections s on s.id = d.section_id
      where s.study_id = _template_study_id
        and d.kind = 'blocks'
        and s.deleted_at is null and s.archived_at is null
      order by s.position
      limit 1
    ),
    case when _src.genre_id is not null then public.genre_blocks_doc(_src.genre_id) end
  )
  where id = _new_study_id;

  for _sec in
    select id, title, position, lineage_id
    from sections
    where study_id = _template_study_id and deleted_at is null and archived_at is null
    order by position
  loop
    insert into sections (study_id, title, position, lineage_id)
    values (_new_study_id, _sec.title, _sec.position, _sec.lineage_id)
    returning id into _new_section_id;

    update documents nd
    set content = td.content
    from documents td
    where td.section_id = _sec.id
      and nd.section_id = _new_section_id
      and nd.kind = td.kind;

    insert into scripture_passages (
      section_id, reference, version, book, book_ordinal,
      start_chapter, start_verse, end_chapter, end_verse,
      start_verse_id, end_verse_id, position
    )
    select
      _new_section_id, reference, version, book, book_ordinal,
      start_chapter, start_verse, end_chapter, end_verse,
      start_verse_id, end_verse_id, position
    from scripture_passages
    where section_id = _sec.id;
  end loop;

  return _new_study_id;
end;
$$;

revoke all on function public.instantiate_study_from_template(uuid, text) from public;
revoke all on function public.instantiate_study_from_template(uuid, text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_study_from_selection: the genre-seeded fallback (branch c) now also
-- sets template_blocks_doc from the genre default. (Blank leaves it NULL; the
-- template/override branches go through instantiate_study_from_template above.)
-- ---------------------------------------------------------------------------
create or replace function public.create_study_from_selection(
  _kind text,
  _title text,
  _book_ordinal smallint default null,
  _template_id uuid default null,
  _genre_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _org uuid;
  _title_clean text := coalesce(nullif(btrim(_title), ''), 'Untitled study');
  _gid uuid := _genre_id;
  _tmpl study_templates;
  _new_study_id uuid;
  _section_id uuid;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  _org := public.my_org_id();

  if _kind = 'blank' then
    insert into studies (owner_id, title) values (_uid, _title_clean)
    returning id into _new_study_id;
    insert into sections (study_id, title, position) values (_new_study_id, 'Introduction', 0);
    return _new_study_id;

  elsif _kind = 'book' then
    if _book_ordinal is null then
      raise exception 'book_ordinal required' using errcode = 'PT400';
    end if;
    if _gid is null then
      select g.id into _gid
      from book_genres bg join genres g on g.slug = bg.genre_slug
      where bg.book_ordinal = _book_ordinal;
    end if;

    -- (a) org override wins
    if _org is not null then
      select * into _tmpl from study_templates
      where scope = 'org' and type = 'book'
        and organization_id = _org and book_ordinal = _book_ordinal and enabled;
      if _tmpl.id is not null then
        return public.instantiate_study_from_template(_tmpl.template_study_id, _title_clean);
      end if;
    end if;

    -- (b) app default, if defaults are allowed and this book isn't disabled
    if _org is null
       or (
         (select use_default_template_library from organizations where id = _org)
         and not exists (
           select 1 from org_disabled_book_templates
           where organization_id = _org and book_ordinal = _book_ordinal
         )
       ) then
      select * into _tmpl from study_templates
      where scope = 'app' and type = 'book' and book_ordinal = _book_ordinal and enabled;
      if _tmpl.id is not null then
        return public.instantiate_study_from_template(_tmpl.template_study_id, _title_clean);
      end if;
    end if;

    -- (c) genre-seeded fallback (never blocks studying a book)
    insert into studies (owner_id, title, genre_id) values (_uid, _title_clean, _gid)
    returning id into _new_study_id;
    insert into sections (study_id, title, position) values (_new_study_id, 'Introduction', 0)
    returning id into _section_id;
    if _gid is not null then
      update documents set content = public.genre_blocks_doc(_gid)
      where section_id = _section_id and kind = 'blocks';
      update studies set template_blocks_doc = public.genre_blocks_doc(_gid)
      where id = _new_study_id;
    end if;
    return _new_study_id;

  elsif _kind = 'custom' then
    if _template_id is null then
      raise exception 'template_id required' using errcode = 'PT400';
    end if;
    select * into _tmpl from study_templates
    where id = _template_id and type = 'custom' and enabled;
    if _tmpl.id is null then
      raise exception 'no such template' using errcode = 'PT400';
    end if;
    if _tmpl.scope = 'org' and not public.is_org_member(_tmpl.organization_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    return public.instantiate_study_from_template(_tmpl.template_study_id, _title_clean);

  else
    raise exception 'unknown kind %', _kind using errcode = 'PT400';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_app_custom_template: seed the new template study's template_blocks_doc
-- from its genre default (the admin then edits it via the Template tab).
-- ---------------------------------------------------------------------------
create or replace function public.create_app_custom_template(
  _name text,
  _genre_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _name_clean text := nullif(btrim(_name), '');
  _study_id uuid;
  _section_id uuid;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_admin() then
    raise exception 'not an app admin' using errcode = '42501';
  end if;
  if _name_clean is null then
    raise exception 'a template needs a name' using errcode = 'PT400';
  end if;

  insert into studies (is_app_template, title, genre_id)
  values (true, _name_clean, _genre_id)
  returning id into _study_id;
  insert into sections (study_id, title, position) values (_study_id, 'Introduction', 0)
  returning id into _section_id;
  if _genre_id is not null then
    update documents set content = public.genre_blocks_doc(_genre_id)
    where section_id = _section_id and kind = 'blocks';
    update studies set template_blocks_doc = public.genre_blocks_doc(_genre_id)
    where id = _study_id;
  end if;

  insert into study_templates (scope, type, genre_id, name, template_study_id, created_by)
  values ('app', 'custom', _genre_id, _name_clean, _study_id, _uid);

  return _study_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_org_template: same — seed the new org template study's template.
-- ---------------------------------------------------------------------------
create or replace function public.create_org_template(
  _type text,
  _book_ordinal smallint default null,
  _name text default null,
  _genre_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _org uuid := public.my_org_id();
  _name_clean text := nullif(btrim(_name), '');
  _gid uuid := _genre_id;
  _study_id uuid;
  _section_id uuid;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if _org is null or not public.is_org_admin(_org) then
    raise exception 'not an organization admin' using errcode = '42501';
  end if;
  if _type not in ('book', 'custom') then
    raise exception 'bad template type' using errcode = 'PT400';
  end if;

  if _type = 'book' then
    if _book_ordinal is null then
      raise exception 'book_ordinal required' using errcode = 'PT400';
    end if;
    if _gid is null then
      select g.id into _gid
      from book_genres bg join genres g on g.slug = bg.genre_slug
      where bg.book_ordinal = _book_ordinal;
    end if;
    if _name_clean is null then
      select book_name into _name_clean from book_genres where book_ordinal = _book_ordinal;
    end if;
  else
    _book_ordinal := null;
    if _name_clean is null then
      raise exception 'a template needs a name' using errcode = 'PT400';
    end if;
  end if;

  insert into studies (owner_org_id, title, genre_id)
  values (_org, _name_clean, _gid)
  returning id into _study_id;
  insert into sections (study_id, title, position) values (_study_id, 'Introduction', 0)
  returning id into _section_id;
  if _gid is not null then
    update documents set content = public.genre_blocks_doc(_gid)
    where section_id = _section_id and kind = 'blocks';
    update studies set template_blocks_doc = public.genre_blocks_doc(_gid)
    where id = _study_id;
  end if;

  insert into study_templates
    (scope, organization_id, type, book_ordinal, genre_id, name, template_study_id, created_by)
  values
    ('org', _org, _type::public.template_type, _book_ordinal, _gid, _name_clean, _study_id, _uid);

  return _study_id;
end;
$$;
