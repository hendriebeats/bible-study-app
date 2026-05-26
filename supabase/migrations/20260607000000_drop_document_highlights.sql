-- ============================================================================
-- Drop the unused `document_highlights` table.
--
-- It was scaffolding from 20260527000300 for a PERSONAL (per-user, out-of-doc)
-- highlight layer that was never wired into the app — no server action, query,
-- or UI ever referenced it. Highlighting instead shipped as shared ProseMirror
-- marks in the document (the selection bubble's `highlight`/`text_color` marks),
-- so this table is dead. Removing it so it can't be mistaken for the live
-- highlighting path. Its RLS policies and updated_at trigger drop with it.
--
-- (Its migration sibling `scripture_passages` is unaffected — that one IS used
-- by scripture insertion + the alignment engine.)
-- ============================================================================

drop table if exists public.document_highlights;
