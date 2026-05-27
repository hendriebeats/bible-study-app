-- ============================================================================
-- Deleting a study that's attached to group(s): let the owner choose what
-- happens to their group membership(s), atomically with the soft-delete.
--
--   * 'keep'   — soft-delete only; the membership row (and its study_id) is
--     left intact, so restoring from Trash silently re-attaches the study.
--   * 'detach' — soft-delete + null the caller's study_id in every membership
--     referencing this study (they stay a "loose" member). Direct UPDATEs to a
--     member's own row are blocked by RLS ("Owners manage member roles" is
--     owner-only), so this MUST run SECURITY DEFINER — same reason
--     attach_study_to_group does.
--   * 'leave'  — soft-delete + delete those membership rows. The deferred
--     enforce_group_has_owner trigger raises PT409 at commit if this would
--     orphan a group of its last owner, rolling back the WHOLE function (the
--     study stays un-trashed) so the caller can re-choose.
--
-- One transaction => 'leave' failure can't half-trash the study. See the
-- approved plan + [[organizations-feature]] / [[data-model]].
-- ============================================================================
create or replace function public.delete_study_with_disposition(
  _study_id uuid,
  _mode text default 'keep'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Only the personal owner may trash their own study this way (group-owned
  -- template studies are not deleted through this path).
  if not exists (
    select 1 from studies where id = _study_id and owner_id = _uid
  ) then
    raise exception 'that is not your study' using errcode = '42501';
  end if;

  update studies
  set deleted_at = now()
  where id = _study_id and owner_id = _uid;

  if _mode = 'detach' then
    update group_study_members
    set study_id = null
    where study_id = _study_id and user_id = _uid;
  elsif _mode = 'leave' then
    delete from group_study_members
    where study_id = _study_id and user_id = _uid;
  end if;
  -- 'keep' (and any unknown mode): soft-delete only, membership left intact.
end;
$$;
