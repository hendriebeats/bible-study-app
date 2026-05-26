-- ============================================================================
-- Phase 2, part 1: the study-template library schema.
--
--   * A "template" is a real backing STUDY (sections + notes/blocks docs + baked
--     scripture/body) plus a `study_templates` registry row. Studies are
--     instantiated from a template by deep-copy (see the RPC migration). This
--     reuses the whole editor + study storage for authoring templates.
--   * Studies gain two new owner axes: `owner_org_id` (org-owned template) and
--     `is_app_template` (app-default, maintained by app super admins). Exactly
--     one of {owner_id, owner_group_id, owner_org_id, is_app_template} holds.
--   * The editor stack is RLS-helper-delegated (documents -> sections ->
--     `is_study_owner`/`can_read_study`), so extending those two helpers makes
--     template studies fully editable/readable in the normal editor with no
--     per-table policy rewrites — only the studies SELECT policy adds branches.
-- See the approved plan + [[phase1-content-model]] / [[data-model]].
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Studies: add org/app ownership axes; widen the single-owner invariant.
-- ---------------------------------------------------------------------------
alter table public.studies
  add column owner_org_id uuid references public.organizations (id) on delete cascade;
alter table public.studies
  add column is_app_template boolean not null default false;

create index studies_owner_org_id_idx on public.studies (owner_org_id);

alter table public.studies drop constraint studies_owner_xor;
alter table public.studies
  add constraint studies_owner_one check (
    (case when owner_id is not null then 1 else 0 end)
  + (case when owner_group_id is not null then 1 else 0 end)
  + (case when owner_org_id is not null then 1 else 0 end)
  + (case when is_app_template then 1 else 0 end)
    = 1
  );

-- ---------------------------------------------------------------------------
-- study_templates registry
-- ---------------------------------------------------------------------------
create type public.template_scope as enum ('app', 'org');
create type public.template_type as enum ('book', 'custom');

create table public.study_templates (
  id uuid primary key default gen_random_uuid(),
  scope public.template_scope not null,
  organization_id uuid references public.organizations (id) on delete cascade,
  type public.template_type not null,
  book_ordinal smallint,
  genre_id uuid references public.genres (id),
  name text not null,
  description text,
  template_study_id uuid not null references public.studies (id) on delete cascade,
  enabled boolean not null default true,
  position integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_templates_scope_org check (
    (scope = 'app' and organization_id is null)
    or (scope = 'org' and organization_id is not null)
  ),
  constraint study_templates_book_ordinal check (
    (type = 'book' and book_ordinal between 1 and 66)
    or (type = 'custom' and book_ordinal is null)
  )
);

-- one app book template per book; one org override per (org, book)
create unique index study_templates_app_book_uniq
  on public.study_templates (book_ordinal)
  where scope = 'app' and type = 'book';
create unique index study_templates_org_book_uniq
  on public.study_templates (organization_id, book_ordinal)
  where scope = 'org' and type = 'book';
create index study_templates_org_idx on public.study_templates (organization_id);
create index study_templates_backing_idx on public.study_templates (template_study_id);

create trigger study_templates_set_updated_at
  before update on public.study_templates
  for each row execute function public.set_updated_at();

-- The study a user created from (lets the editor re-derive "template blocks").
-- on delete set null => deleting a template never alters existing studies.
alter table public.studies
  add column source_template_id uuid references public.study_templates (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Org disable model: a master switch + a sparse per-book disable set.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column use_default_template_library boolean not null default true;

create table public.org_disabled_book_templates (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  book_ordinal smallint not null check (book_ordinal between 1 and 66),
  primary key (organization_id, book_ordinal)
);

-- ---------------------------------------------------------------------------
-- book_genres: SQL-side book -> genre map (mirrors GENRE_BY_ORDINAL in
-- src/lib/scripture/books.ts). Backstops the create RPC + drives provisioning.
-- ---------------------------------------------------------------------------
create table public.book_genres (
  book_ordinal smallint primary key check (book_ordinal between 1 and 66),
  book_name text not null,
  genre_slug text not null references public.genres (slug)
);

insert into public.book_genres (book_ordinal, book_name, genre_slug) values
  (1,'Genesis','law'),(2,'Exodus','law'),(3,'Leviticus','law'),(4,'Numbers','law'),
  (5,'Deuteronomy','law'),
  (6,'Joshua','narrative'),(7,'Judges','narrative'),(8,'Ruth','narrative'),
  (9,'1 Samuel','narrative'),(10,'2 Samuel','narrative'),(11,'1 Kings','narrative'),
  (12,'2 Kings','narrative'),(13,'1 Chronicles','narrative'),(14,'2 Chronicles','narrative'),
  (15,'Ezra','narrative'),(16,'Nehemiah','narrative'),(17,'Esther','narrative'),
  (18,'Job','wisdom'),(19,'Psalms','wisdom'),(20,'Proverbs','wisdom'),
  (21,'Ecclesiastes','wisdom'),(22,'Song of Solomon','wisdom'),
  (23,'Isaiah','prophecy'),(24,'Jeremiah','prophecy'),(25,'Lamentations','prophecy'),
  (26,'Ezekiel','prophecy'),
  (27,'Daniel','apocalyptic'),
  (28,'Hosea','prophecy'),(29,'Joel','prophecy'),(30,'Amos','prophecy'),
  (31,'Obadiah','prophecy'),(32,'Jonah','narrative'),(33,'Micah','prophecy'),
  (34,'Nahum','prophecy'),(35,'Habakkuk','prophecy'),(36,'Zephaniah','prophecy'),
  (37,'Haggai','prophecy'),(38,'Zechariah','prophecy'),(39,'Malachi','prophecy'),
  (40,'Matthew','gospel'),(41,'Mark','gospel'),(42,'Luke','gospel'),(43,'John','gospel'),
  (44,'Acts','narrative'),
  (45,'Romans','epistle'),(46,'1 Corinthians','epistle'),(47,'2 Corinthians','epistle'),
  (48,'Galatians','epistle'),(49,'Ephesians','epistle'),(50,'Philippians','epistle'),
  (51,'Colossians','epistle'),(52,'1 Thessalonians','epistle'),(53,'2 Thessalonians','epistle'),
  (54,'1 Timothy','epistle'),(55,'2 Timothy','epistle'),(56,'Titus','epistle'),
  (57,'Philemon','epistle'),(58,'Hebrews','epistle'),(59,'James','epistle'),
  (60,'1 Peter','epistle'),(61,'2 Peter','epistle'),(62,'1 John','epistle'),
  (63,'2 John','epistle'),(64,'3 John','epistle'),(65,'Jude','epistle'),
  (66,'Revelation','apocalyptic');

-- ============================================================================
-- Security-definer helpers
-- ============================================================================

-- May the caller EDIT this template-backing study?
create or replace function public.can_edit_template_study(_study_id uuid)
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
        (s.is_app_template and public.is_admin())
        or (s.owner_org_id is not null and public.is_org_admin(s.owner_org_id))
      )
  );
$$;

-- May the caller READ this template-backing study (for instantiation/preview)?
create or replace function public.can_read_template_study(_study_id uuid)
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
        s.is_app_template
        or (s.owner_org_id is not null
            and (public.is_org_member(s.owner_org_id) or public.is_admin()))
      )
  );
$$;

-- Extend study ownership to cover app/org template studies. Because sections,
-- documents, history and realtime auth all delegate to this helper, admins and
-- org admins can edit template studies through the EXISTING policies.
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
        or (s.is_app_template and public.is_admin())
        or (s.owner_org_id is not null and public.is_org_admin(s.owner_org_id))
      )
  );
$$;

-- Extend readability to cover app templates (all authed) + org templates
-- (org members + app admins).
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
        or s.is_app_template
        or (s.owner_org_id is not null
            and (public.is_org_member(s.owner_org_id) or public.is_admin()))
      )
  );
$$;

-- ============================================================================
-- RLS
-- ============================================================================

-- studies SELECT: add template-read branches (mirror can_read_study). Other
-- studies policies (update/delete/insert) are unchanged: update/delete already
-- flow through is_study_owner (now template-aware); insert stays owner-only so
-- template studies are created only via the SECURITY DEFINER RPCs.
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
      or is_app_template
      or (
        owner_org_id is not null
        and (public.is_org_member(owner_org_id) or public.is_admin())
      )
    )
  );

alter table public.study_templates enable row level security;
alter table public.org_disabled_book_templates enable row level security;
alter table public.book_genres enable row level security;

create policy "Read app templates and your org templates"
  on public.study_templates for select
  to authenticated
  using (
    scope = 'app'
    or (scope = 'org' and (public.is_org_member(organization_id) or public.is_admin()))
  );

create policy "App admins manage app templates"
  on public.study_templates for all
  to authenticated
  using (scope = 'app' and public.is_admin())
  with check (scope = 'app' and public.is_admin());

create policy "Org admins manage their org templates"
  on public.study_templates for all
  to authenticated
  using (scope = 'org' and public.is_org_admin(organization_id))
  with check (scope = 'org' and public.is_org_admin(organization_id));

create policy "Org members read disabled-book set"
  on public.org_disabled_book_templates for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "Org admins manage disabled-book set"
  on public.org_disabled_book_templates for all
  to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy "Anyone can read the book-genre map"
  on public.book_genres for select
  to authenticated
  using (true);

create policy "Admins manage the book-genre map"
  on public.book_genres for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
