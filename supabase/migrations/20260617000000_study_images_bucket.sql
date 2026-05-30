-- ============================================================================
-- Study images storage: public "study-images" bucket. Files live under
--   {userId}/{studyId}/{imageId}.{ext}      -- live
--   _trash/{userId}/{studyId}/{imageId}.ext -- soft-deleted (30-day retention,
--                                              swept by sweep-trashed-images
--                                              edge function)
--
-- Reads: any collaborator on the parent study (can_read_study).
-- Writes (insert/update/delete): only the study owner (is_study_owner). UPDATE
-- is needed so the editor can `move` files into `_trash/` on save-time orphan
-- cleanup.
--
-- The bucket is technically public so `getPublicUrl` returns a static URL we
-- can stick in <img src>, but `storage.objects` RLS gates every actual read.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('study-images', 'study-images', true)
on conflict (id) do nothing;

-- Helper: extract the studyId from the object path. Live paths put the studyId
-- at folder index 2 (after the user id at index 1). Trash paths prepend
-- `_trash`, shifting the studyId to index 3.
create or replace function public._study_image_study_id(_name text)
returns uuid
language sql
immutable
as $$
  select case
    when (storage.foldername(_name))[1] = '_trash'
      then ((storage.foldername(_name))[3])::uuid
    else ((storage.foldername(_name))[2])::uuid
  end
$$;

create policy "Study images: collaborators can read"
  on storage.objects for select
  using (
    bucket_id = 'study-images'
    and public.can_read_study(public._study_image_study_id(name))
  );

create policy "Study images: owner can upload"
  on storage.objects for insert
  with check (
    bucket_id = 'study-images'
    and (select auth.uid())::text = (storage.foldername(name))[1]
    and public.is_study_owner(public._study_image_study_id(name))
  );

create policy "Study images: owner can update (incl. move to/from trash)"
  on storage.objects for update
  using (
    bucket_id = 'study-images'
    and public.is_study_owner(public._study_image_study_id(name))
  )
  with check (
    bucket_id = 'study-images'
    and public.is_study_owner(public._study_image_study_id(name))
  );

create policy "Study images: owner can delete"
  on storage.objects for delete
  using (
    bucket_id = 'study-images'
    and public.is_study_owner(public._study_image_study_id(name))
  );
