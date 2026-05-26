-- ============================================================================
-- Fold the org website + contact email into the PROFILE (one identity form),
-- and slim the verification dossier down to just a note. The org's name,
-- description, address, website and contact email now come from the profile,
-- so verification stops re-asking for them.
-- ============================================================================

alter table public.organizations
  add column website text,
  add column contact_email text;

-- Carry over anything previously captured during verification.
update public.organizations set
  website = coalesce(website, verification_website),
  contact_email = coalesce(contact_email, verification_contact_email);

alter table public.organizations
  drop column verification_official_name,
  drop column verification_website,
  drop column verification_contact_email;

-- submit_org_verification now only takes the optional note; identity comes from
-- the profile. Drop the old 4-arg signature first.
drop function if exists public.submit_org_verification(text, text, text, text);

create or replace function public.submit_org_verification(_note text default null)
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
    verification_note = nullif(btrim(_note), ''),
    verification_status = 'pending',
    verification_reject_reason = null
  where id = _org;
end;
$$;
