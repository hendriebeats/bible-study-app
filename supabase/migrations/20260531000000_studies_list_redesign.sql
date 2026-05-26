-- ============================================================================
-- Studies list redesign: surface group invitations + loose-group attachment to
-- the studies list ("Your studies") and its top-bar notifications bell.
--
--   * list_my_invitations()  — let an invitee discover pending invitations
--     addressed to THEIR email (the "Owners manage invitations" RLS policy
--     intentionally hides invitations from invitees, so this is SECURITY
--     DEFINER and token is the only opaque value returned).
--   * decline_invitation()   — let the addressee decline (-> 'revoked'; the
--     invitation_status enum has no 'declined' value, and 'revoked' already
--     means "no longer pending").
--   * attach_study_to_group() — attach an existing owned study OR a fresh
--     template seed to the caller's own membership row (the group creator joins
--     with study_id = null; this resolves that "loose" state). Mirrors the
--     attach-or-seed branch of accept_invitation().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- list_my_invitations: pending, non-expired invitations addressed to the
-- caller's email, excluding groups they already belong to. Email match is
-- case-insensitive (invitation emails are user-typed).
-- ---------------------------------------------------------------------------
create or replace function public.list_my_invitations()
returns table (
  token text,
  group_study_id uuid,
  group_name text,
  invite_role text,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select i.token, i.group_study_id, g.name, i.role, i.expires_at
  from invitations i
  join group_studies g on g.id = i.group_study_id
  join auth.users u on u.id = auth.uid()
  where i.status = 'pending'
    and i.expires_at > now()
    and i.email is not null
    and lower(i.email) = lower(u.email)
    and not exists (
      select 1 from group_study_members m
      where m.group_study_id = i.group_study_id
        and m.user_id = auth.uid()
    );
$$;

-- ---------------------------------------------------------------------------
-- decline_invitation: the addressee marks a pending invitation 'revoked'.
-- ---------------------------------------------------------------------------
create or replace function public.decline_invitation(_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _inv invitations;
  _email text;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select email into _email from auth.users where id = _uid;

  select * into _inv from invitations where token = _token;
  if _inv.id is null then
    raise exception 'invalid invitation' using errcode = 'PT400';
  end if;
  if _inv.email is null or lower(_inv.email) <> lower(_email) then
    raise exception 'not your invitation' using errcode = '42501';
  end if;

  if _inv.status = 'pending' then
    update invitations set status = 'revoked' where id = _inv.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- attach_study_to_group: set the caller's own membership study_id, either to an
-- existing study they own or a fresh seed from the group's template. Resolves a
-- "loose" membership (study_id = null). Returns the attached study id.
-- ---------------------------------------------------------------------------
create or replace function public.attach_study_to_group(
  _group_study_id uuid,
  _study_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _study uuid;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from group_study_members
    where group_study_id = _group_study_id and user_id = _uid
  ) then
    raise exception 'you are not a member of this group' using errcode = '42501';
  end if;

  if _study_id is not null then
    if not exists (
      select 1 from studies where id = _study_id and owner_id = _uid
    ) then
      raise exception 'that is not your study' using errcode = '42501';
    end if;
    _study := _study_id;
  else
    _study := public.seed_study_from_template(_group_study_id);
  end if;

  update group_study_members
  set study_id = _study
  where group_study_id = _group_study_id and user_id = _uid;

  return _study;
end;
$$;
