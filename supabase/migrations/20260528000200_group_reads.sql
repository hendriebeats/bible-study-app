-- ============================================================================
-- Group Studies, part 3: reads needed by the group UI.
--   * Group co-members can read each other's basic profile (name/avatar) — for
--     the roster, presence, and compare. (Still only own + co-members.)
--   * `get_invitation` lets an invitee see the group name/role before they're a
--     member (token-gated, SECURITY DEFINER) so the accept page can show it.
-- ============================================================================

create or replace function public.shares_group_with_user(_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from group_study_members me
    join group_study_members them on them.group_study_id = me.group_study_id
    where me.user_id = auth.uid() and them.user_id = _user_id
  );
$$;

create policy "Read profiles of group co-members"
  on public.profiles for select
  to authenticated
  using (public.shares_group_with_user(id));

create or replace function public.get_invitation(_token text)
returns table (
  group_study_id uuid,
  group_name text,
  invite_role text,
  status text,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select i.group_study_id, g.name, i.role, i.status::text, i.expires_at
  from invitations i
  join group_studies g on g.id = i.group_study_id
  where i.token = _token;
$$;
