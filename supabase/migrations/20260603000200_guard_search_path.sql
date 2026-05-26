-- ============================================================================
-- Harden guard_org_verification with a fixed search_path (matches the repo's
-- other functions). It references no unqualified objects, but pinning the
-- search_path closes the "function_search_path_mutable" advisory.
-- ============================================================================
create or replace function public.guard_org_verification()
returns trigger
language plpgsql
set search_path = public
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
