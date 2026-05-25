import type { RealtimeChannel } from "@supabase/supabase-js";

import type { CursorPayload, StepsPayload } from "@/lib/editor/types";
import { createClient } from "@/lib/supabase/client";

const STEPS_EVENT = "steps";
const CURSOR_EVENT = "cursor";

export interface SectionChannelHandlers {
  onSteps?: (payload: StepsPayload) => void;
  onCursor?: (payload: CursorPayload) => void;
}

/**
 * Open a Supabase Realtime broadcast channel for a section. The writer sends
 * steps + cursor; read-only viewers receive them. `self: false` so the writer
 * doesn't echo its own messages. The DB step log remains the durable source of
 * truth — broadcast is just the low-latency path (viewers resync on gaps).
 */
export function openSectionChannel(
  sectionId: string,
  handlers: SectionChannelHandlers,
): RealtimeChannel {
  const supabase = createClient();
  const channel = supabase.channel(`section:${sectionId}`, {
    config: { broadcast: { self: false } },
  });

  if (handlers.onSteps) {
    channel.on("broadcast", { event: STEPS_EVENT }, (message) => {
      handlers.onSteps?.(message.payload as StepsPayload);
    });
  }
  if (handlers.onCursor) {
    channel.on("broadcast", { event: CURSOR_EVENT }, (message) => {
      handlers.onCursor?.(message.payload as CursorPayload);
    });
  }

  channel.subscribe();
  return channel;
}

export function broadcastSteps(
  channel: RealtimeChannel,
  payload: StepsPayload,
): void {
  void channel.send({ type: "broadcast", event: STEPS_EVENT, payload });
}

export function broadcastCursor(
  channel: RealtimeChannel,
  payload: CursorPayload,
): void {
  void channel.send({ type: "broadcast", event: CURSOR_EVENT, payload });
}
