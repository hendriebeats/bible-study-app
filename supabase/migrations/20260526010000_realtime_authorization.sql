-- ============================================================================
-- Realtime Authorization for section read-along channels.
--
-- Section broadcast channels are named "section:<uuid>" and marked `private` by
-- the client, which makes Realtime evaluate RLS on `realtime.messages`:
--   * RECEIVE (select): anyone who can read the section (owner or co-member).
--   * SEND (insert): the section OWNER only — there is exactly one writer, so a
--     co-member can no longer broadcast spoofed steps/cursors to other viewers.
-- Reuses the existing can_read_section / is_section_owner helpers.
-- ============================================================================

-- Resolve the section id from a "section:<uuid>" channel topic (null for any
-- other topic, which then denies). SECURITY DEFINER so it can read
-- `realtime.topic()` regardless of the caller's grants; the topic is a
-- transaction-local setting, so the definer context still sees the right value.
create or replace function public.realtime_section_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select case
    when realtime.topic() ~ '^section:[0-9a-fA-F-]{36}$'
      then substring(realtime.topic() from 9)::uuid
  end;
$$;

drop policy if exists "Receive section broadcasts" on realtime.messages;
create policy "Receive section broadcasts"
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'broadcast'
    and public.can_read_section(public.realtime_section_id())
  );

drop policy if exists "Send section broadcasts" on realtime.messages;
create policy "Send section broadcasts"
  on realtime.messages
  for insert
  to authenticated
  with check (
    extension = 'broadcast'
    and public.is_section_owner(public.realtime_section_id())
  );
