-- ============================================================================
-- Every section must own a `notes` and a `blocks` document. The init backfill
-- covered existing sections; this trigger guarantees it for every new section
-- (createStudy/createSection, and later group-template seeding) so the section
-- page never finds a section without its documents.
-- ============================================================================
create or replace function public.create_section_documents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.documents (section_id, kind)
  values (new.id, 'notes'), (new.id, 'blocks')
  on conflict (section_id, kind) do nothing;
  return new;
end;
$$;

create trigger sections_create_documents
  after insert on public.sections
  for each row execute function public.create_section_documents();

-- Backfill any sections that somehow lack a document (defensive; the init
-- migration should have created them all).
insert into public.documents (section_id, kind)
select s.id, k.kind
from public.sections s
cross join (values ('notes'::public.document_kind), ('blocks'::public.document_kind)) as k(kind)
on conflict (section_id, kind) do nothing;
