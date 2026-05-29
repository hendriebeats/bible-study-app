-- Fix-up for 20260614000000_history_finer_grouping.sql:
-- `create or replace function` on a function with a NEW parameter creates an
-- overload alongside the old function rather than replacing it, which leaves
-- ambiguous-call errors on the next 5-arg invocation. This migration drops
-- the pre-boundaries signatures explicitly so only the new ones remain.
--
-- The original migration was also edited to include these drops at the top
-- so a fresh `db reset` is correct without this file; this stand-alone
-- migration brings already-deployed databases into the same state.

drop function if exists public.append_document_steps(uuid, integer, jsonb, jsonb, text);
drop function if exists public.document_history_moments(uuid);
