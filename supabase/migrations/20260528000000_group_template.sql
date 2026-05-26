-- ============================================================================
-- First-class Group Studies, part 1: a group-owned standalone TEMPLATE study,
-- owner/member roles, and a shared section "lineage" slot.
--
--   * A study is now owned by EITHER a user (`owner_id`) OR a group
--     (`owner_group_id`) — exactly one. The group-owned study is the group's
--     canonical TEMPLATE; group OWNERS may edit it, members read it, and new
--     members seed their own study from it.
--   * `group_study_members.role` is 'owner' | 'member'; `study_id` is now
--     NULLABLE so an owner can manage a group without having contributed a
--     study yet.
--   * `sections.lineage_id` is the shared slot id: template sections define it,
--     seeded member sections inherit it, so sections line up across studies
--     (Phase 3 alignment). Standalone studies get their own fresh ids.
-- See the approved plan + [[phase1-content-model]] / [[data-model]].
-- ============================================================================

-- Shared slot lineage on sections (volatile default -> unique per existing row).
alter table public.sections
  add column lineage_id uuid not null default gen_random_uuid();

-- A study is owned by a user XOR a group.
alter table public.studies
  alter column owner_id drop not null;
alter table public.studies
  add column owner_group_id uuid references public.group_studies (id) on delete cascade;
alter table public.studies
  add constraint studies_owner_xor check (
    (owner_id is not null and owner_group_id is null)
    or (owner_id is null and owner_group_id is not null)
  );
create index studies_owner_group_id_idx on public.studies (owner_group_id);

-- The group's canonical template study.
alter table public.group_studies
  add column template_study_id uuid references public.studies (id) on delete set null;

-- An owner may belong to a group without contributing a study (yet).
alter table public.group_study_members
  alter column study_id drop not null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Is the current user an OWNER of this group?
create or replace function public.is_group_owner(_group_study_id uuid)
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
      and m.role = 'owner'
  );
$$;

-- Study ownership now also covers a group owner editing the group's template.
create or replace function public.is_study_owner(_study_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from studies s
    where s.id = _study_id
      and (
        s.owner_id = auth.uid()
        or (s.owner_group_id is not null and public.is_group_owner(s.owner_group_id))
      )
  );
$$;

-- Readability now also covers group members reading the group's template study.
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
      and s.archived_at is null
      and (
        s.owner_id = auth.uid()
        or public.shares_group_with_study(s.id)
        or (s.owner_group_id is not null and public.is_group_member(s.owner_group_id))
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS updates
-- ---------------------------------------------------------------------------

-- studies: read own + group co-members' + the group's template (archived hidden;
-- trashed hidden from non-personal-owners).
drop policy "Read own studies or group co-members' studies" on public.studies;
create policy "Read own studies or group co-members' studies"
  on public.studies for select
  using (
    archived_at is null
    and (
      owner_id = (select auth.uid())
      or (public.shares_group_with_study(id) and deleted_at is null)
      or (
        owner_group_id is not null
        and public.is_group_member(owner_group_id)
        and deleted_at is null
      )
    )
  );

-- Update/delete now flow through is_study_owner (covers group owners on the
-- template). Insert stays personal-only; template/seeded studies are created by
-- the SECURITY DEFINER RPCs in the next migration.
drop policy "Update own studies" on public.studies;
create policy "Update own studies"
  on public.studies for update
  using (public.is_study_owner(id))
  with check (public.is_study_owner(id));

drop policy "Delete own studies" on public.studies;
create policy "Delete own studies"
  on public.studies for delete
  using (public.is_study_owner(id));

-- group_studies: creator OR any owner may rename/delete.
drop policy "Update group studies you created" on public.group_studies;
create policy "Update group studies you manage"
  on public.group_studies for update
  using (created_by = (select auth.uid()) or public.is_group_owner(id))
  with check (created_by = (select auth.uid()) or public.is_group_owner(id));

drop policy "Delete group studies you created" on public.group_studies;
create policy "Delete group studies you manage"
  on public.group_studies for delete
  using (created_by = (select auth.uid()) or public.is_group_owner(id));

-- group_study_members: relax insert for null study_id; owners manage roles and
-- can remove members; members can still leave.
drop policy "Join a group with your own study" on public.group_study_members;
create policy "Join a group with your own study"
  on public.group_study_members for insert
  with check (
    user_id = (select auth.uid())
    and (study_id is null or public.is_study_owner(study_id))
  );

create policy "Owners manage member roles"
  on public.group_study_members for update
  using (public.is_group_owner(group_study_id))
  with check (public.is_group_owner(group_study_id));

drop policy "Leave groups you joined" on public.group_study_members;
create policy "Leave a group or be removed by an owner"
  on public.group_study_members for delete
  using (
    user_id = (select auth.uid())
    or public.is_group_owner(group_study_id)
  );
