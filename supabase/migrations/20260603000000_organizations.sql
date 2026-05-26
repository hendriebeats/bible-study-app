-- ============================================================================
-- Organizations, part 1: the org entity + single membership with a role
-- hierarchy (super_admin > admin > member).
--
--   * An organization is a church/ministry that gathers members, brands their
--     experience, and (later) publishes study templates. A user belongs to
--     EXACTLY ONE org (or none) — enforced by unique(user_id) on the membership.
--   * Roles: 'super_admin' (add/remove admins & super admins), 'admin' (invite/
--     remove members, edit branding/profile, post announcements), 'member'.
--     A guard trigger keeps at least one super admin (mirrors the group
--     owner guard). Super-admin status is transferable; multiple are allowed.
--   * New orgs start visibility='unlisted', verification='unverified'. Only a
--     verified org may go 'public' (searchable). Verification is reviewed by app
--     admins (profiles.is_admin) and can only change through the review RPC — a
--     guard trigger blocks org admins from self-verifying via a direct UPDATE.
--   * Personal studies are unaffected by org membership: leaving/removal/deletion
--     never touches a user's studies — only org branding/templates stop applying.
-- See the approved plan + [[data-model]].
-- ============================================================================

create type public.org_role as enum ('super_admin', 'admin', 'member');
create type public.org_visibility as enum ('public', 'unlisted');
create type public.org_join_policy as enum ('request', 'open');
create type public.org_verification_status as enum (
  'unverified',
  'pending',
  'verified',
  'rejected'
);

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  icon_url text,
  -- structured address (search results show city/region/country)
  city text,
  region text,
  country text,
  visibility public.org_visibility not null default 'unlisted',
  join_policy public.org_join_policy not null default 'request',
  verification_status public.org_verification_status not null default 'unverified',
  -- verification submission + review fields (changed only via the RPCs)
  verification_official_name text,
  verification_website text,
  verification_contact_email text,
  verification_note text,
  verification_reviewed_by uuid references auth.users (id) on delete set null,
  verification_reviewed_at timestamptz,
  verification_reject_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- only a verified org may be public/searchable
  constraint organizations_public_requires_verified check (
    visibility <> 'public' or verification_status = 'verified'
  )
);

create index organizations_discovery_idx
  on public.organizations (verification_status, visibility);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- Verification status / review fields may ONLY change inside the verification
-- RPCs (which set a transaction-local flag). This stops an org admin — who can
-- otherwise UPDATE branding/profile directly — from self-verifying and then
-- going public.
create or replace function public.guard_org_verification()
returns trigger
language plpgsql
as $$
begin
  if (
        new.verification_status     is distinct from old.verification_status
     or new.verification_reviewed_by is distinct from old.verification_reviewed_by
     or new.verification_reviewed_at is distinct from old.verification_reviewed_at
     or new.verification_reject_reason is distinct from old.verification_reject_reason
     )
     and coalesce(current_setting('app.org_verification', true), '') <> 'on' then
    raise exception 'verification can only change through the verification workflow'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger organizations_guard_verification
  before update on public.organizations
  for each row execute function public.guard_org_verification();

-- ---------------------------------------------------------------------------
-- organization_members: a user belongs to at most one org (unique(user_id)).
-- ---------------------------------------------------------------------------
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  joined_at timestamptz not null default now(),
  unique (user_id),                       -- *** exactly one org per user ***
  unique (organization_id, user_id)
);

create index organization_members_org_idx
  on public.organization_members (organization_id);

-- ============================================================================
-- Security-definer helpers (same style as is_group_owner / is_admin): they run
-- as the owner, bypassing RLS *inside* the function so policies can reference
-- the membership table without recursive RLS evaluation.
-- ============================================================================

-- The caller's org (or null).
create or replace function public.my_org_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select organization_id from organization_members where user_id = auth.uid();
$$;

-- Is the caller a member of this org?
create or replace function public.is_org_member(_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = _org_id and m.user_id = auth.uid()
  );
$$;

-- Is the caller an admin or super admin of this org?
create or replace function public.is_org_admin(_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = _org_id
      and m.user_id = auth.uid()
      and m.role in ('admin', 'super_admin')
  );
$$;

-- Is the caller a super admin of this org?
create or replace function public.is_org_super_admin(_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = _org_id
      and m.user_id = auth.uid()
      and m.role = 'super_admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- An org must always keep at least one super admin (cross-row invariant ->
-- trigger). Deferred so multi-row ops (and org cascade-deletes) settle first;
-- a sole super admin can still delete the org (members cascade away -> the org
-- has zero members -> no exception).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_org_has_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _org uuid := coalesce(old.organization_id, new.organization_id);
begin
  if exists (select 1 from organization_members where organization_id = _org)
     and not exists (
       select 1 from organization_members
       where organization_id = _org and role = 'super_admin'
     ) then
    raise exception 'an organization must keep at least one super admin'
      using errcode = 'PT409';
  end if;
  return null;
end;
$$;

create constraint trigger organization_members_super_admin_guard
  after update or delete on public.organization_members
  deferrable initially deferred
  for each row execute function public.enforce_org_has_super_admin();

-- ---------------------------------------------------------------------------
-- create_organization: make an org and add the caller as its first super
-- admin. Rejects callers who already belong to an org.
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(
  _name text,
  _description text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _name_clean text := nullif(btrim(_name), '');
  _desc_clean text := nullif(btrim(_description), '');
  _org_id uuid;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if _name_clean is null then
    raise exception 'an organization needs a name' using errcode = 'PT400';
  end if;
  if _desc_clean is null then
    raise exception 'an organization needs a description' using errcode = 'PT400';
  end if;
  if exists (select 1 from organization_members where user_id = _uid) then
    raise exception 'you already belong to an organization' using errcode = 'PT409';
  end if;

  insert into organizations (name, description, created_by)
  values (_name_clean, _desc_clean, _uid)
  returning id into _org_id;

  insert into organization_members (organization_id, user_id, role)
  values (_org_id, _uid, 'super_admin');

  return _org_id;
end;
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

-- organizations --------------------------------------------------------------
-- Read: your own org; any public+verified org (search); app admins read all
-- (verification queue). Insert is RPC-only (create_organization, definer).
create policy "Read your org, public verified orgs, or as app admin"
  on public.organizations for select
  to authenticated
  using (
    public.is_org_member(id)
    or (visibility = 'public' and verification_status = 'verified')
    or public.is_admin()
  );

-- Org admins edit branding/profile/visibility/join_policy directly. Verification
-- columns are locked by guard_org_verification; review runs via a definer RPC.
create policy "Org admins update their org"
  on public.organizations for update
  to authenticated
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

create policy "Org super admins delete their org"
  on public.organizations for delete
  to authenticated
  using (public.is_org_super_admin(id));

-- organization_members -------------------------------------------------------
-- Read your own row or any co-member's. Insert is RPC-only (create/accept/join).
create policy "Read your membership or co-members"
  on public.organization_members for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_org_member(organization_id)
  );

-- Only super admins change roles (promote/demote admins & super admins).
create policy "Super admins manage member roles"
  on public.organization_members for update
  to authenticated
  using (public.is_org_super_admin(organization_id))
  with check (public.is_org_super_admin(organization_id));

-- Leave yourself; super admins remove anyone; admins remove only members.
-- The super-admin guard trigger blocks removing/leaving the last super admin.
create policy "Leave, or be removed per role"
  on public.organization_members for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_org_super_admin(organization_id)
    or (public.is_org_admin(organization_id) and role = 'member')
  );

-- ============================================================================
-- Org icon storage: a public "org-icons" bucket. Files live under
-- org-icons/<org_id>/... so only that org's admins can write; reads are public
-- so the stored URL works in <img>.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('org-icons', 'org-icons', true)
on conflict (id) do nothing;

create policy "Org icons are publicly readable"
  on storage.objects for select
  using (bucket_id = 'org-icons');

create policy "Org admins upload org icons"
  on storage.objects for insert
  with check (
    bucket_id = 'org-icons'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );

create policy "Org admins update org icons"
  on storage.objects for update
  using (
    bucket_id = 'org-icons'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'org-icons'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );

create policy "Org admins delete org icons"
  on storage.objects for delete
  using (
    bucket_id = 'org-icons'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );
