-- Lightweight version-history "moments" for a document: one row per save-batch
-- (steps appended together share a created_at), newest first, capped well under
-- PostgREST's max_rows (1000). Lets the history scrubber build its timeline
-- without transferring the whole step log; a chosen point is then materialized
-- on demand from the nearest checkpoint + its trailing steps.
create or replace function public.document_history_moments(_document_id uuid)
returns table(version integer, created_at timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.can_read_document(_document_id) then
    raise exception 'not authorized to read document %', _document_id
      using errcode = '42501';
  end if;
  return query
    select max(s.version)::integer as version, s.created_at
    from section_steps s
    where s.document_id = _document_id
    group by s.created_at
    order by s.created_at desc
    limit 1000;
end;
$$;
