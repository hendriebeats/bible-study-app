-- ============================================================================
-- First-class Group Studies, part 2: invitations + the RPCs that create a
-- group (with its template), seed a member's study from the template, and
-- accept an invitation. Plus a guard so a group always keeps an owner.
-- ============================================================================

create type public.invitation_status as enum (
  'pending',
  'accepted',
  'revoked',
  'expired'
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  group_study_id uuid not null references public.group_studies (id) on delete cascade,
  email text,
  token text not null unique,
  inviter_id uuid references auth.users (id) on delete set null,
  role text not null default 'member',
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invitations_group_idx on public.invitations (group_study_id);

create trigger invitations_set_updated_at
  before update on public.invitations
  for each row execute function public.set_updated_at();

alter table public.invitations enable row level security;

-- Group owners manage their group's invitations. Acceptance is via the
-- SECURITY DEFINER RPC below (validates the token), so invitees need no policy.
create policy "Owners manage invitations"
  on public.invitations for all
  to authenticated
  using (public.is_group_owner(group_study_id))
  with check (public.is_group_owner(group_study_id));

-- ---------------------------------------------------------------------------
-- A group must always keep at least one owner (cross-row invariant -> trigger).
-- Deferred so multi-row operations (and group cascade-deletes) settle first.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_group_has_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _group uuid := coalesce(old.group_study_id, new.group_study_id);
begin
  if exists (select 1 from group_study_members where group_study_id = _group)
     and not exists (
       select 1 from group_study_members
       where group_study_id = _group and role = 'owner'
     ) then
    raise exception 'a group study must keep at least one owner'
      using errcode = 'PT409';
  end if;
  return null;
end;
$$;

create constraint trigger group_study_members_owner_guard
  after update or delete on public.group_study_members
  deferrable initially deferred
  for each row execute function public.enforce_group_has_owner();

-- ---------------------------------------------------------------------------
-- create_group_study: make a group + its (group-owned) template study, seed the
-- template with one starter section, and add the creator as an owner.
-- ---------------------------------------------------------------------------
create or replace function public.create_group_study(_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _name_clean text := coalesce(nullif(btrim(_name), ''), 'Group study');
  _group_id uuid;
  _template_id uuid;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into group_studies (name, created_by)
  values (_name_clean, _uid)
  returning id into _group_id;

  insert into studies (owner_group_id, title)
  values (_group_id, _name_clean || ' — template')
  returning id into _template_id;

  update group_studies set template_study_id = _template_id where id = _group_id;

  insert into sections (study_id, title, position)
  values (_template_id, 'Introduction', 0);

  insert into group_study_members (group_study_id, study_id, user_id, role)
  values (_group_id, null, _uid, 'owner');

  return _group_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- seed_study_from_template: deep-copy the group's template into a NEW study
-- owned by the caller — section structure + shared lineage + notes/blocks doc
-- content (incl. scripture nodes & their normalized passages). Personal
-- highlights are never copied (they live in a separate per-user table).
-- ---------------------------------------------------------------------------
create or replace function public.seed_study_from_template(_group_study_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _template_id uuid;
  _group_name text;
  _new_study_id uuid;
  _sec record;
  _new_section_id uuid;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select template_study_id, name into _template_id, _group_name
  from group_studies where id = _group_study_id;
  if _template_id is null then
    raise exception 'group % has no template', _group_study_id using errcode = 'P0002';
  end if;

  insert into studies (owner_id, title)
  values (_uid, coalesce(_group_name, 'Study'))
  returning id into _new_study_id;

  for _sec in
    select id, title, position, lineage_id
    from sections
    where study_id = _template_id and deleted_at is null and archived_at is null
    order by position
  loop
    insert into sections (study_id, title, position, lineage_id)
    values (_new_study_id, _sec.title, _sec.position, _sec.lineage_id)
    returning id into _new_section_id;

    -- The section-insert trigger created empty notes/blocks docs; copy the
    -- template's content into them, matched by kind.
    update documents nd
    set content = td.content
    from documents td
    where td.section_id = _sec.id
      and nd.section_id = _new_section_id
      and nd.kind = td.kind;

    -- Copy the normalized scripture sidecar rows.
    insert into scripture_passages (
      section_id, reference, version, book, book_ordinal,
      start_chapter, start_verse, end_chapter, end_verse,
      start_verse_id, end_verse_id, position
    )
    select
      _new_section_id, reference, version, book, book_ordinal,
      start_chapter, start_verse, end_chapter, end_verse,
      start_verse_id, end_verse_id, position
    from scripture_passages
    where section_id = _sec.id;
  end loop;

  return _new_study_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- accept_invitation: validate the token, then add the caller to the group —
-- attaching an existing study they own (_study_id) or seeding a fresh one from
-- the template. Idempotent if already a member. Returns the group id.
-- ---------------------------------------------------------------------------
create or replace function public.accept_invitation(
  _token text,
  _study_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _inv invitations;
  _study uuid;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into _inv from invitations where token = _token;
  if _inv.id is null then
    raise exception 'invalid invitation' using errcode = 'PT400';
  end if;
  if _inv.status <> 'pending' then
    raise exception 'this invitation is no longer valid' using errcode = 'PT400';
  end if;
  if _inv.expires_at < now() then
    update invitations set status = 'expired' where id = _inv.id;
    raise exception 'this invitation has expired' using errcode = 'PT400';
  end if;

  -- Already in the group? Mark accepted and return.
  if exists (
    select 1 from group_study_members
    where group_study_id = _inv.group_study_id and user_id = _uid
  ) then
    update invitations
    set status = 'accepted', accepted_by = _uid
    where id = _inv.id;
    return _inv.group_study_id;
  end if;

  if _study_id is not null then
    if not exists (
      select 1 from studies where id = _study_id and owner_id = _uid
    ) then
      raise exception 'that is not your study' using errcode = '42501';
    end if;
    _study := _study_id;
  else
    _study := public.seed_study_from_template(_inv.group_study_id);
  end if;

  insert into group_study_members (group_study_id, study_id, user_id, role)
  values (_inv.group_study_id, _study, _uid, _inv.role);

  update invitations
  set status = 'accepted', accepted_by = _uid
  where id = _inv.id;

  return _inv.group_study_id;
end;
$$;
