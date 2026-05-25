-- ============================================================================
-- Presence authorization for section read-along channels.
--
-- The broadcast policies (20260526010000) cover only `extension = 'broadcast'`,
-- so presence messages (`extension = 'presence'`) were denied for everyone and
-- "who's viewing" never synced across peers. Presence carries no write
-- authority over the document — it only announces that a participant is here —
-- so any section reader may both announce their own presence and see others'.
-- Steps/cursor broadcasts remain OWNER-only (the broadcast policies are
-- unchanged); a co-member still cannot push spoofed edits.
-- ============================================================================

drop policy if exists "Receive section presence" on realtime.messages;
create policy "Receive section presence"
  on realtime.messages
  for select
  to authenticated
  using (
    extension = 'presence'
    and public.can_read_section(public.realtime_section_id())
  );

drop policy if exists "Send section presence" on realtime.messages;
create policy "Send section presence"
  on realtime.messages
  for insert
  to authenticated
  with check (
    extension = 'presence'
    and public.can_read_section(public.realtime_section_id())
  );
