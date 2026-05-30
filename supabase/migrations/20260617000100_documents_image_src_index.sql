-- ============================================================================
-- Per-document image src index for reference-counted cleanup.
--
-- On every save (append_document_steps), the client computes the set of
-- image-node `src` URLs in the new doc and sends it along. The RPC overwrites
-- this column and returns the diff `previous − new` so the client can `move`
-- removed files into the bucket's `_trash/` subpath. Avoids walking the doc
-- on the server or listing the bucket on every save.
--
-- Default '{}' is correct for every existing document (none reference images
-- yet — confirmed via pre-migration scan).
-- ============================================================================

alter table public.documents
  add column if not exists image_src_index text[] not null default '{}';

comment on column public.documents.image_src_index is
  'Set of image-node src URLs currently present in `content`. Maintained by '
  'append_document_steps. Used to diff for soft-delete cleanup of orphaned '
  'files in the study-images bucket.';
