-- ============================================================================
-- Realtime Authorization for per-DOCUMENT read-along channels.
--
-- With content generalized onto `documents`, read-along now happens on channels
-- named "document:<uuid>" (one per notes/blocks doc) instead of "section:<uuid>".
-- Same contract as the section channels (20260526010000 / 20260526020000):
--   * RECEIVE (broadcast + presence): anyone who can read the document.
--   * SEND broadcast (steps/cursor): the document OWNER only.
--   * SEND presence: any reader (presence carries no write authority).
-- The old section:<uuid> policies are LEFT IN PLACE during the transition so a
-- client mid-migration keeps working; they simply never match a document topic.
-- ============================================================================

-- Resolve the document id from a "document:<uuid>" topic (null otherwise, which
-- then denies). "document:" is 9 chars, so the uuid starts at offset 10.
create or replace function public.realtime_document_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select case
    when realtime.topic() ~ '^document:[0-9a-fA-F-]{36}$'
      then substring(realtime.topic() from 10)::uuid
  end;
$$;

drop policy if exists "Receive document broadcasts" on realtime.messages;
create policy "Receive document broadcasts"
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'broadcast'
    and public.can_read_document(public.realtime_document_id())
  );

drop policy if exists "Send document broadcasts" on realtime.messages;
create policy "Send document broadcasts"
  on realtime.messages
  for insert
  to authenticated
  with check (
    extension = 'broadcast'
    and public.is_document_owner(public.realtime_document_id())
  );

drop policy if exists "Receive document presence" on realtime.messages;
create policy "Receive document presence"
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'presence'
    and public.can_read_document(public.realtime_document_id())
  );

drop policy if exists "Send document presence" on realtime.messages;
create policy "Send document presence"
  on realtime.messages
  for insert
  to authenticated
  with check (
    extension = 'presence'
    and public.can_read_document(public.realtime_document_id())
  );
