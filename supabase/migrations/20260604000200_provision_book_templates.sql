-- ============================================================================
-- Phase 2, part 3: provision the 66 default app book templates.
-- Each is an is_app_template study with one 'Introduction' section whose blocks
-- are seeded from the book's genre set. Idempotent: skips books that already
-- have an app book template (also guarded by study_templates_app_book_uniq).
-- ============================================================================
do $$
declare
  _b record;
  _gid uuid;
  _study_id uuid;
  _section_id uuid;
begin
  for _b in select book_ordinal, book_name, genre_slug from book_genres order by book_ordinal loop
    if exists (
      select 1 from study_templates
      where scope = 'app' and type = 'book' and book_ordinal = _b.book_ordinal
    ) then
      continue;
    end if;

    select id into _gid from genres where slug = _b.genre_slug;

    insert into studies (is_app_template, title, genre_id)
    values (true, _b.book_name, _gid)
    returning id into _study_id;

    insert into sections (study_id, title, position)
    values (_study_id, 'Introduction', 0)
    returning id into _section_id;

    update documents set content = public.genre_blocks_doc(_gid)
    where section_id = _section_id and kind = 'blocks';

    insert into study_templates
      (scope, type, book_ordinal, genre_id, name, template_study_id, position)
    values
      ('app', 'book', _b.book_ordinal, _gid, _b.book_name, _study_id, _b.book_ordinal);
  end loop;
end $$;
