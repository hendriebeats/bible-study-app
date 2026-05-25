-- ============================================================================
-- Initial schema: profiles, studies, sections, group studies, memberships.
-- See memory/data-model for the entity model and uniqueness rules.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Shared helper: keep updated_at current on UPDATE.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: app-level user data, 1:1 with auth.users.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- studies: a study "project" owned by exactly one user.
-- ---------------------------------------------------------------------------
create table public.studies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled study',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index studies_owner_id_idx on public.studies (owner_id);

create trigger studies_set_updated_at
  before update on public.studies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- sections: each is its own ProseMirror document; ordered within a study.
-- Users edit one section at a time (content loaded lazily).
-- ---------------------------------------------------------------------------
create table public.sections (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  title text not null default 'Untitled section',
  position integer not null default 0,
  content jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sections_study_id_position_idx
  on public.sections (study_id, position);

create trigger sections_set_updated_at
  before update on public.sections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- group_studies: a shared study that collects studies from different users.
-- ---------------------------------------------------------------------------
create table public.group_studies (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Group study',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger group_studies_set_updated_at
  before update on public.group_studies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- group_study_members: links a user's ONE study into a group study.
--   * a study appears in a group at most once  -> unique(group_study_id, study_id)
--   * a user contributes one study per group    -> unique(group_study_id, user_id)
-- ---------------------------------------------------------------------------
create table public.group_study_members (
  id uuid primary key default gen_random_uuid(),
  group_study_id uuid not null references public.group_studies (id) on delete cascade,
  study_id uuid not null references public.studies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  unique (group_study_id, study_id),
  unique (group_study_id, user_id)
);

create index group_study_members_user_id_idx
  on public.group_study_members (user_id);
create index group_study_members_study_id_idx
  on public.group_study_members (study_id);

-- ============================================================================
-- Security-definer helpers. These run with the function owner's privileges,
-- bypassing RLS *inside* the function so policies can reference other tables
-- without recursive RLS evaluation.
-- ============================================================================

-- Does the current user share any group study with this study?
create or replace function public.shares_group_with_study(_study_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from group_study_members gsm
    join group_study_members me
      on me.group_study_id = gsm.group_study_id
    where gsm.study_id = _study_id
      and me.user_id = auth.uid()
  );
$$;

-- Is the current user the owner of this study?
create or replace function public.is_study_owner(_study_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from studies s
    where s.id = _study_id and s.owner_id = auth.uid()
  );
$$;

-- May the current user read this study (owner or group co-member)?
create or replace function public.can_read_study(_study_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from studies s
    where s.id = _study_id
      and (s.owner_id = auth.uid() or public.shares_group_with_study(s.id))
  );
$$;

-- Is the current user a member of this group study?
create or replace function public.is_group_member(_group_study_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from group_study_members m
    where m.group_study_id = _group_study_id
      and m.user_id = auth.uid()
  );
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.studies enable row level security;
alter table public.sections enable row level security;
alter table public.group_studies enable row level security;
alter table public.group_study_members enable row level security;

-- profiles -------------------------------------------------------------------
create policy "Profiles are viewable by their owner"
  on public.profiles for select
  using (id = (select auth.uid()));

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (id = (select auth.uid()));

create policy "Users can update their own profile"
  on public.profiles for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- studies --------------------------------------------------------------------
create policy "Read own studies or group co-members' studies"
  on public.studies for select
  using (owner_id = (select auth.uid()) or public.shares_group_with_study(id));

create policy "Create own studies"
  on public.studies for insert
  with check (owner_id = (select auth.uid()));

create policy "Update own studies"
  on public.studies for update
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Delete own studies"
  on public.studies for delete
  using (owner_id = (select auth.uid()));

-- sections -------------------------------------------------------------------
create policy "Read sections of readable studies"
  on public.sections for select
  using (public.can_read_study(study_id));

create policy "Insert sections into own studies"
  on public.sections for insert
  with check (public.is_study_owner(study_id));

create policy "Update sections of own studies"
  on public.sections for update
  using (public.is_study_owner(study_id))
  with check (public.is_study_owner(study_id));

create policy "Delete sections of own studies"
  on public.sections for delete
  using (public.is_study_owner(study_id));

-- group_studies --------------------------------------------------------------
create policy "Read group studies you belong to or created"
  on public.group_studies for select
  using (created_by = (select auth.uid()) or public.is_group_member(id));

create policy "Create group studies"
  on public.group_studies for insert
  with check (created_by = (select auth.uid()));

create policy "Update group studies you created"
  on public.group_studies for update
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

create policy "Delete group studies you created"
  on public.group_studies for delete
  using (created_by = (select auth.uid()));

-- group_study_members --------------------------------------------------------
create policy "Read memberships of your groups"
  on public.group_study_members for select
  using (user_id = (select auth.uid()) or public.is_group_member(group_study_id));

-- You may only add YOUR OWN study, as yourself. The unique constraints then
-- enforce one-study-per-group and one-membership-per-user-per-group.
create policy "Join a group with your own study"
  on public.group_study_members for insert
  with check (
    user_id = (select auth.uid())
    and public.is_study_owner(study_id)
  );

create policy "Leave groups you joined"
  on public.group_study_members for delete
  using (user_id = (select auth.uid()));
