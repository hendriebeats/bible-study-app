import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import type { RealtimeChannel } from "@supabase/supabase-js";

import type { CursorPayload, StepsPayload } from "@/lib/editor/types";
import { createClient } from "@/lib/supabase/client";

const STEPS_EVENT = "steps";
const CURSOR_EVENT = "cursor";

/** Subscription health, surfaced to the UI as a live/reconnecting indicator. */
export type ConnectionStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "closed";

/** A stable, readable color palette for cursors + presence avatars. */
const CURSOR_COLORS = [
  "#1971c2",
  "#e8590c",
  "#2f9e44",
  "#9c36b5",
  "#c2255c",
  "#0c8599",
  "#5f3dc4",
  "#e67700",
];

/** Deterministic color for a user id, so the same person is always one color. */
export function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return CURSOR_COLORS[hash % CURSOR_COLORS.length] ?? "#1971c2";
}

/** Someone currently on the document (the writer or a read-along viewer). */
export interface PresenceMember {
  userId: string;
  name: string;
  color: string;
  isOwner: boolean;
}

/** Who this client is, for presence tracking + a labeled remote cursor. */
export interface DocumentIdentity {
  userId: string;
  name: string;
  isOwner: boolean;
}

/**
 * The metadata each client tracks into presence. The index signature lets it
 * satisfy supabase-js's `{ [key: string]: any }` presence constraint.
 */
interface PresenceMeta {
  userId: string;
  name: string;
  isOwner: boolean;
  [key: string]: string | boolean;
}

export interface DocumentChannelHandlers {
  onSteps?: (payload: StepsPayload) => void;
  onCursor?: (payload: CursorPayload) => void;
  onPresence?: (members: PresenceMember[]) => void;
  onStatus?: (status: ConnectionStatus) => void;
}

/**
 * Open a Supabase Realtime broadcast channel for a document. The writer sends
 * steps + cursor; read-only viewers receive them. `self: false` so the writer
 * doesn't echo its own messages. The DB step log remains the durable source of
 * truth — broadcast is just the low-latency path (viewers resync on gaps).
 *
 * When `identity` is given, the client also joins presence (so everyone can see
 * who's here) and reports subscription health via `onStatus`.
 *
 * The channel is `private`, so access is gated by RLS on `realtime.messages`
 * (see the realtime-documents migration): only the document owner may send,
 * and only readers may receive. We authenticate the socket with the user's JWT
 * before subscribing; supabase-js keeps it current on token refresh.
 */
export async function openDocumentChannel(
  documentId: string,
  handlers: DocumentChannelHandlers,
  identity?: DocumentIdentity,
): Promise<RealtimeChannel> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) {
    await supabase.realtime.setAuth(session.access_token);
  }

  const channel = supabase.channel(`document:${documentId}`, {
    config: {
      broadcast: { self: false },
      private: true,
      ...(identity ? { presence: { key: identity.userId } } : {}),
    },
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
  if (handlers.onPresence) {
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresenceMeta>();
      const members: PresenceMember[] = [];
      const seen = new Set<string>();
      for (const presences of Object.values(state)) {
        for (const presence of presences) {
          if (seen.has(presence.userId)) {
            continue;
          }
          seen.add(presence.userId);
          members.push({
            userId: presence.userId,
            name: presence.name,
            color: colorForId(presence.userId),
            isOwner: presence.isOwner,
          });
        }
      }
      handlers.onPresence?.(members);
    });
  }

  handlers.onStatus?.("connecting");
  channel.subscribe((status) => {
    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
      handlers.onStatus?.("live");
      if (identity) {
        const meta: PresenceMeta = {
          userId: identity.userId,
          name: identity.name,
          isOwner: identity.isOwner,
        };
        void channel.track(meta);
      }
    } else if (
      status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
      status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
    ) {
      handlers.onStatus?.("reconnecting");
    } else {
      // The only remaining state is CLOSED.
      handlers.onStatus?.("closed");
    }
  });
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
