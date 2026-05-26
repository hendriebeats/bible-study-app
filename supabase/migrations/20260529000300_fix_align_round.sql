-- ============================================================================
-- Fix align_sections: the score expression includes similarity() (returns
-- `real`), so the sum is `double precision` — and two-argument round() only
-- exists for `numeric`. Cast the score to numeric before rounding.
-- ============================================================================
create or replace function public.align_sections(
  _my_section_id uuid,
  _target_study_id uuid
)
returns table (
  section_id uuid,
  title text,
  section_position integer,
  score numeric,
  lineage_match boolean,
  overlap numeric
)
language plpgsql
security definer
set search_path = public, extensions
stable
as $$
declare
  _my_lineage uuid;
  _my_title text;
  _my_position integer;
begin
  if not (public.can_read_section(_my_section_id)
          and public.can_read_study(_target_study_id)) then
    return;
  end if;

  select s.lineage_id, s.title, s.position
    into _my_lineage, _my_title, _my_position
  from sections s where s.id = _my_section_id;

  return query
  with my_pass as (
    select sp.start_verse_id as sv, sp.end_verse_id as ev
    from scripture_passages sp where sp.section_id = _my_section_id
  ),
  scored as (
    select
      t.id,
      t.title as t_title,
      t.position as t_position,
      (t.lineage_id = _my_lineage) as is_lineage,
      coalesce((
        select max(
          case when least(mp.ev, tp.end_verse_id) >= greatest(mp.sv, tp.start_verse_id)
            then (least(mp.ev, tp.end_verse_id) - greatest(mp.sv, tp.start_verse_id) + 1)::numeric
                 / nullif(least(mp.ev - mp.sv + 1, tp.end_verse_id - tp.start_verse_id + 1), 0)
            else 0 end)
        from my_pass mp
        join scripture_passages tp on tp.section_id = t.id
      ), 0) as ov
    from sections t
    where t.study_id = _target_study_id
      and t.deleted_at is null
      and t.archived_at is null
  )
  select
    sc.id,
    sc.t_title,
    sc.t_position,
    round((
      (case when sc.is_lineage then 1000 else 0 end)
      + 500 * sc.ov
      + 80 * coalesce(similarity(sc.t_title, _my_title), 0)
      + greatest(0, 20 - abs(sc.t_position - _my_position))
    )::numeric, 2) as score,
    sc.is_lineage,
    round(sc.ov, 3) as overlap
  from scored sc
  order by score desc, sc.t_position asc;
end;
$$;
