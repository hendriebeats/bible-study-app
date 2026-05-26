-- ============================================================================
-- Organizations, part 2: the membership flows — invitations, join requests,
-- announcements, notifications — and the RPCs that drive them.
--
--   * organization_invitations mirrors the group `invitations` table (reusing
--     the shared invitation_status enum); acceptance is a token-gated definer
--     RPC, so invitees need no read policy.
--   * organization_join_requests backs the "request to join" path for public
--     verified orgs whose join_policy = 'request' (open orgs auto-join).
--   * organization_announcements + a minimal generic `notifications` table:
--     posting an announcement fans out one notification per member so the
--     header bell can surface it. dismissed_announcements backs the dashboard
--     banner's per-user dismissal.
-- See the approved plan + [[data-model]].
-- ============================================================================

-- ---------------------------------------------------------------------------
-- organization_invitations (mirror public.invitations; reuse invitation_status)
-- ---------------------------------------------------------------------------
create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text,
  token text not null unique,
  inviter_id uuid references auth.users (id) on delete set null,
  role public.org_role not null default 'member',
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index organization_invitations_org_idx
  on public.organization_invitations (organization_id);

create trigger organization_invitations_set_updated_at
  before update on public.organization_invitations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- organization_join_requests (request-to-join queue)
-- ---------------------------------------------------------------------------
create type public.join_request_status as enum ('pending', 'approved', 'denied');

create table public.organization_join_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status public.join_request_status not null default 'pending',
  note text,
  reviewed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- at most one pending request per user per org
create unique index organization_join_requests_pending_uniq
  on public.organization_join_requests (organization_id, user_id)
  where status = 'pending';

create index organization_join_requests_org_idx
  on public.organization_join_requests (organization_id, status);

create trigger organization_join_requests_set_updated_at
  before update on public.organization_join_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- organization_announcements (admin -> members, plain text)
-- ---------------------------------------------------------------------------
create table public.organization_announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create index organization_announcements_org_idx
  on public.organization_announcements (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- notifications: a minimal generic bell backend (the prior bell was derived
-- only). Announcement fan-out writes one row per member.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  organization_id uuid references public.organizations (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx
  on public.notifications (user_id, read_at, created_at desc);

-- ---------------------------------------------------------------------------
-- dismissed_announcements: per-user dismissal of the dashboard banner.
-- ---------------------------------------------------------------------------
create table public.dismissed_announcements (
  user_id uuid not null references auth.users (id) on delete cascade,
  announcement_id uuid not null references public.organization_announcements (id) on delete cascade,
  primary key (user_id, announcement_id)
);

-- ---------------------------------------------------------------------------
-- Org co-members can read each other's basic profile (roster). Mirrors
-- shares_group_with_user.
-- ---------------------------------------------------------------------------
create or replace function public.shares_org_with_user(_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from organization_members me
    join organization_members them on them.organization_id = me.organization_id
    where me.user_id = auth.uid() and them.user_id = _user_id
  );
$$;

create policy "Read profiles of org co-members"
  on public.profiles for select
  to authenticated
  using (public.shares_org_with_user(id));

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.organization_invitations enable row level security;
alter table public.organization_join_requests enable row level security;
alter table public.organization_announcements enable row level security;
alter table public.notifications enable row level security;
alter table public.dismissed_announcements enable row level security;

-- organization_invitations: org admins manage; acceptance via definer RPC.
create policy "Org admins manage invitations"
  on public.organization_invitations for all
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- organization_join_requests: admins (their org) + the requester can read.
-- Insert/update flow through definer RPCs.
create policy "Org admins or requester read join requests"
  on public.organization_join_requests for select
  to authenticated
  using (
    public.is_org_admin(organization_id)
    or user_id = (select auth.uid())
  );

-- organization_announcements: members read; admins may delete; posting is via
-- the fan-out RPC (definer).
create policy "Members read announcements"
  on public.organization_announcements for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "Org admins delete announcements"
  on public.organization_announcements for delete
  to authenticated
  using (public.is_org_admin(organization_id));

-- notifications: you read / mark read / clear your own. Insert via definer RPC.
create policy "Read your notifications"
  on public.notifications for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Update your notifications"
  on public.notifications for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Delete your notifications"
  on public.notifications for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- dismissed_announcements: fully owned by the user.
create policy "Manage your announcement dismissals"
  on public.dismissed_announcements for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ============================================================================
-- RPCs (SECURITY DEFINER, `_param` naming, auth.uid() null-guard 42501)
-- ============================================================================

-- request_to_join_org: for a public+verified org, either auto-join (open) or
-- file a pending request (request). Rejects callers already in an org.
-- Returns 'joined' or 'requested'.
create or replace function public.request_to_join_org(
  _org uuid,
  _note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _o organizations;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from organization_members where user_id = _uid) then
    raise exception 'you already belong to an organization' using errcode = 'PT409';
  end if;

  select * into _o from organizations where id = _org;
  if _o.id is null then
    raise exception 'organization not found' using errcode = 'PT400';
  end if;
  if _o.visibility <> 'public' or _o.verification_status <> 'verified' then
    raise exception 'this organization is not open to join requests' using errcode = '42501';
  end if;

  if _o.join_policy = 'open' then
    insert into organization_members (organization_id, user_id, role)
    values (_org, _uid, 'member');
    return 'joined';
  end if;

  if not exists (
    select 1 from organization_join_requests
    where organization_id = _org and user_id = _uid and status = 'pending'
  ) then
    insert into organization_join_requests (organization_id, user_id, note)
    values (_org, _uid, nullif(btrim(_note), ''));
  end if;
  return 'requested';
end;
$$;

-- approve_join_request: org admin admits a pending requester (re-checking the
-- single-membership invariant).
create or replace function public.approve_join_request(_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _req organization_join_requests;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into _req from organization_join_requests where id = _id;
  if _req.id is null then
    raise exception 'request not found' using errcode = 'PT400';
  end if;
  if not public.is_org_admin(_req.organization_id) then
    raise exception 'not an organization admin' using errcode = '42501';
  end if;
  if _req.status <> 'pending' then
    raise exception 'this request is no longer pending' using errcode = 'PT400';
  end if;
  if exists (select 1 from organization_members where user_id = _req.user_id) then
    update organization_join_requests set status = 'denied', reviewed_by = _uid where id = _id;
    raise exception 'this user already belongs to an organization' using errcode = 'PT409';
  end if;

  insert into organization_members (organization_id, user_id, role)
  values (_req.organization_id, _req.user_id, 'member');
  update organization_join_requests set status = 'approved', reviewed_by = _uid where id = _id;
end;
$$;

-- deny_join_request: org admin declines a pending request.
create or replace function public.deny_join_request(_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _req organization_join_requests;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into _req from organization_join_requests where id = _id;
  if _req.id is null then
    raise exception 'request not found' using errcode = 'PT400';
  end if;
  if not public.is_org_admin(_req.organization_id) then
    raise exception 'not an organization admin' using errcode = '42501';
  end if;
  if _req.status = 'pending' then
    update organization_join_requests set status = 'denied', reviewed_by = _uid where id = _id;
  end if;
end;
$$;

-- accept_org_invitation: validate the token, then add the caller as a member
-- with the invite's role. Rejects callers already in a (different) org.
create or replace function public.accept_org_invitation(_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _inv organization_invitations;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into _inv from organization_invitations where token = _token;
  if _inv.id is null then
    raise exception 'invalid invitation' using errcode = 'PT400';
  end if;
  if _inv.status <> 'pending' then
    raise exception 'this invitation is no longer valid' using errcode = 'PT400';
  end if;
  if _inv.expires_at < now() then
    update organization_invitations set status = 'expired' where id = _inv.id;
    raise exception 'this invitation has expired' using errcode = 'PT400';
  end if;

  -- Already in THIS org? Mark accepted and return.
  if exists (
    select 1 from organization_members
    where organization_id = _inv.organization_id and user_id = _uid
  ) then
    update organization_invitations set status = 'accepted', accepted_by = _uid where id = _inv.id;
    return _inv.organization_id;
  end if;

  -- In a DIFFERENT org? Single-membership blocks acceptance.
  if exists (select 1 from organization_members where user_id = _uid) then
    raise exception 'you already belong to an organization' using errcode = 'PT409';
  end if;

  insert into organization_members (organization_id, user_id, role)
  values (_inv.organization_id, _uid, _inv.role);
  update organization_invitations set status = 'accepted', accepted_by = _uid where id = _inv.id;
  return _inv.organization_id;
end;
$$;

-- decline_org_invitation: the addressee marks a pending invitation 'revoked'.
create or replace function public.decline_org_invitation(_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _inv organization_invitations;
  _email text;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select email into _email from auth.users where id = _uid;
  select * into _inv from organization_invitations where token = _token;
  if _inv.id is null then
    raise exception 'invalid invitation' using errcode = 'PT400';
  end if;
  if _inv.email is null or lower(_inv.email) <> lower(_email) then
    raise exception 'not your invitation' using errcode = '42501';
  end if;
  if _inv.status = 'pending' then
    update organization_invitations set status = 'revoked' where id = _inv.id;
  end if;
end;
$$;

-- list_my_org_invitations: pending, non-expired invitations addressed to the
-- caller's email, excluding callers already in an org.
create or replace function public.list_my_org_invitations()
returns table (
  token text,
  organization_id uuid,
  organization_name text,
  invite_role public.org_role,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select i.token, i.organization_id, o.name, i.role, i.expires_at
  from organization_invitations i
  join organizations o on o.id = i.organization_id
  join auth.users u on u.id = auth.uid()
  where i.status = 'pending'
    and i.expires_at > now()
    and i.email is not null
    and lower(i.email) = lower(u.email)
    and not exists (
      select 1 from organization_members m where m.user_id = auth.uid()
    );
$$;

-- get_org_invitation: token-gated preview for the accept page.
create or replace function public.get_org_invitation(_token text)
returns table (
  organization_id uuid,
  organization_name text,
  invite_role public.org_role,
  status text,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select i.organization_id, o.name, i.role, i.status::text, i.expires_at
  from organization_invitations i
  join organizations o on o.id = i.organization_id
  where i.token = _token;
$$;

-- submit_org_verification: an org admin submits the dossier -> status 'pending'.
-- Sets the transaction-local flag so guard_org_verification permits the change.
create or replace function public.submit_org_verification(
  _official_name text,
  _website text,
  _contact_email text,
  _note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _org uuid := public.my_org_id();
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if _org is null or not public.is_org_admin(_org) then
    raise exception 'not an organization admin' using errcode = '42501';
  end if;

  perform set_config('app.org_verification', 'on', true);
  update organizations set
    verification_official_name = nullif(btrim(_official_name), ''),
    verification_website = nullif(btrim(_website), ''),
    verification_contact_email = nullif(btrim(_contact_email), ''),
    verification_note = nullif(btrim(_note), ''),
    verification_status = 'pending',
    verification_reject_reason = null
  where id = _org;
end;
$$;

-- review_org_verification: an app admin (profiles.is_admin) approves or rejects.
create or replace function public.review_org_verification(
  _org uuid,
  _decision text,
  _reason text default null
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
  if not public.is_admin() then
    raise exception 'not an app admin' using errcode = '42501';
  end if;
  if _decision not in ('verified', 'rejected') then
    raise exception 'invalid decision' using errcode = 'PT400';
  end if;

  perform set_config('app.org_verification', 'on', true);
  update organizations set
    verification_status = _decision::public.org_verification_status,
    verification_reviewed_by = _uid,
    verification_reviewed_at = now(),
    verification_reject_reason = case
      when _decision = 'rejected' then nullif(btrim(_reason), '')
      else null
    end
  where id = _org;
end;
$$;

-- post_org_announcement: insert an announcement and fan out one notification
-- per member (excluding the author).
create or replace function public.post_org_announcement(_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _org uuid := public.my_org_id();
  _body_clean text := nullif(btrim(_body), '');
  _name text;
  _ann_id uuid;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if _org is null or not public.is_org_admin(_org) then
    raise exception 'not an organization admin' using errcode = '42501';
  end if;
  if _body_clean is null then
    raise exception 'an announcement needs a message' using errcode = 'PT400';
  end if;

  select name into _name from organizations where id = _org;

  insert into organization_announcements (organization_id, author_id, body)
  values (_org, _uid, _body_clean)
  returning id into _ann_id;

  insert into notifications (user_id, kind, title, body, link, organization_id)
  select m.user_id, 'org_announcement', _name, _body_clean, '/organizations', _org
  from organization_members m
  where m.organization_id = _org and m.user_id <> _uid;

  return _ann_id;
end;
$$;

-- mark_notifications_read: mark the caller's unread notifications read (all, or
-- a given subset).
create or replace function public.mark_notifications_read(_ids uuid[] default null)
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
  update notifications set read_at = now()
  where user_id = _uid
    and read_at is null
    and (_ids is null or id = any(_ids));
end;
$$;
