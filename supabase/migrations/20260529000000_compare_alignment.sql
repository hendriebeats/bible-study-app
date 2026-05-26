-- ============================================================================
-- Phase 3: compare workspace persistence + the section ALIGNMENT engine.
--
--   * workspace_states: a user's saved dockview layout per study (open tabs,
--     splits) so the compare workspace survives refresh / re-entry.
--   * section_alignments: which of another member's sections lines up with MY
--     section (remembered manual override + per-person scroll position).
--   * align_sections(): ranks a target study's sections against my section by
--     (1) shared lineage slot, (2) scripture verse-range OVERLAP (containment,
--     so "2 chapters vs 1" still matches), (3) title similarity + position.
-- "Just works": auto-pick the top candidate; the UI may override + persist it.
-- ============================================================================

create extension if not exists pg_trgm;

create table public.workspace_states (
  user_id uuid not null references auth.users (id) on delete cascade,
  study_id uuid not null references public.studies (id) on delete cascade,
  layout jsonb not null,
  layout_version integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, study_id)
);

create trigger workspace_states_set_updated_at
  before update on public.workspace_states
  for each row execute function public.set_updated_at();

alter table public.workspace_states enable row level security;

create policy "Manage your own workspace state"
  on public.workspace_states for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Remembered alignment + scroll for (me, my section, a target study).
create table public.section_alignments (
  user_id uuid not null references auth.users (id) on delete cascade,
  my_section_id uuid not null references public.sections (id) on delete cascade,
  target_study_id uuid not null references public.studies (id) on delete cascade,
  target_section_id uuid references public.sections (id) on delete set null,
  scroll_top integer not null default 0,
  is_manual boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, my_section_id, target_study_id)
);

create trigger section_alignments_set_updated_at
  before update on public.section_alignments
  for each row execute function public.set_updated_at();

alter table public.section_alignments enable row level security;

create policy "Manage your own alignments"
  on public.section_alignments for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- align_sections: rank a target study's sections against my section.
-- SECURITY DEFINER but gated on can_read_section/can_read_study so it never
-- leaks. Overlap uses the packed verse ids; containment = overlap / smaller
-- range, so a verse within a chapter (or a chapter within a multi-chapter
-- range) still scores high. pg_trgm `similarity` lives in the extensions schema.
-- ---------------------------------------------------------------------------
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
    select start_verse_id as sv, end_verse_id as ev
    from scripture_passages where section_id = _my_section_id
  ),
  scored as (
    select
      t.id,
      t.title as t_title,
      t.position as t_position,
      (t.lineage_id = _my_lineage) as is_lineage,
      coalesce((
        select max(
          case when least(mp.ev, tp.ev) >= greatest(mp.sv, tp.sv)
            then (least(mp.ev, tp.ev) - greatest(mp.sv, tp.sv) + 1)::numeric
                 / nullif(least(mp.ev - mp.sv + 1, tp.ev - tp.sv + 1), 0)
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
    round(
      (case when sc.is_lineage then 1000 else 0 end)
      + 500 * sc.ov
      + 80 * coalesce(similarity(sc.t_title, _my_title), 0)
      + greatest(0, 20 - abs(sc.t_position - _my_position))
    , 2) as score,
    sc.is_lineage,
    round(sc.ov, 3) as overlap
  from scored sc
  order by score desc, sc.t_position asc;
end;
$$;
