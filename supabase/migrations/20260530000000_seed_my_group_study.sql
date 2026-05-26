-- ============================================================================
-- Close the "owner has no study" gap: a group owner is added to
-- group_study_members with study_id = null (they author the template), and the
-- only path to a contributed study was the member invite -> accept -> seed
-- flow. So an owner could neither be a compare target nor use Compare. This RPC
-- lets ANY member whose membership has no study seed their own study from the
-- group's template (carrying section lineage, so it aligns with everyone
-- else's), and attaches it to their membership. Idempotent: returns the
-- existing study if they already have one in this group.
-- ============================================================================
create or replace function public.seed_my_group_study(_group_study_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _existing uuid;
  _new_study uuid;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select study_id into _existing
  from group_study_members
  where group_study_id = _group_study_id and user_id = _uid;
  if not found then
    raise exception 'you are not a member of this group' using errcode = '42501';
  end if;

  -- Already contributing a study here — hand it back rather than duplicate.
  if _existing is not null then
    return _existing;
  end if;

  _new_study := public.seed_study_from_template(_group_study_id);

  update group_study_members
  set study_id = _new_study
  where group_study_id = _group_study_id and user_id = _uid;

  return _new_study;
end;
$$;
