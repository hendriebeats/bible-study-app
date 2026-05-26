"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";

import { fetchDocumentHead } from "@/app/studies/actions";
import { PresenceAvatars } from "@/components/studies/presence-avatars";
import type { StudyDocument } from "@/lib/db/types";
import { buildNodeViews } from "@/lib/editor/node-views";
import {
  remoteCursor,
  remoteCursorKey,
} from "@/lib/editor/plugins/remote-cursor";
import { schema } from "@/lib/editor/schema";
import { jsonToDoc, jsonToStep } from "@/lib/editor/serialize";
import type { PMDocJSON } from "@/lib/editor/types";
import { openDocumentChannel } from "@/lib/realtime/document-channel";
import type {
  ConnectionStatus,
  PresenceMember,
} from "@/lib/realtime/document-channel";

function viewerDoc(content: PMDocJSON) {
  const doc = jsonToDoc(content);
  return doc.childCount > 0 ? doc : (schema.topNodeType.createAndFill() ?? doc);
}

function viewerState(content: PMDocJSON): EditorState {
  return EditorState.create({
    doc: viewerDoc(content),
    plugins: [remoteCursor()],
  });
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  live: "live",
  reconnecting: "Reconnecting…",
  closed: "Disconnected",
};

/**
 * Read-only live view of one document a co-member doesn't own. Mirrors the
 * writer's edits and labeled cursor via Supabase Realtime; the editor isn't
 * editable. Shows who else is reading along and the connection's health.
 */
export function DocumentViewer({
  document: doc,
  me,
  label,
}: {
  document: StudyDocument;
  me: { id: string; name: string } | null;
  label: string;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const versionRef = useRef(doc.current_version);
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const view = new EditorView(mount, {
      state: viewerState(doc.content),
      editable: () => false,
      nodeViews: buildNodeViews(false),
      dispatchTransaction(transaction) {
        const current = viewRef.current;
        if (!current) {
          return;
        }
        current.updateState(current.state.apply(transaction));
      },
    });
    viewRef.current = view;

    async function resync() {
      const head = await fetchDocumentHead(doc.id);
      const current = viewRef.current;
      if (!head || !current) {
        return;
      }
      current.updateState(viewerState(head.content));
      versionRef.current = head.version;
    }

    let channel: RealtimeChannel | undefined;
    let disposed = false;
    void openDocumentChannel(
      doc.id,
      {
        onSteps({ base, steps, version }) {
          const current = viewRef.current;
          if (!current) {
            return;
          }
          if (base !== versionRef.current) {
            // Missed or out-of-order batch — pull the head and reset.
            if (base > versionRef.current) {
              void resync();
            }
            return;
          }
          try {
            let tr = current.state.tr;
            for (const step of steps) {
              tr = tr.step(jsonToStep(step));
            }
            current.dispatch(tr);
            versionRef.current = version;
          } catch {
            void resync();
          }
        },
        onCursor({ anchor, head, name, color }) {
          const current = viewRef.current;
          if (current) {
            current.dispatch(
              current.state.tr.setMeta(remoteCursorKey, {
                anchor,
                head,
                name,
                color,
              }),
            );
          }
        },
        onPresence(next) {
          if (!disposed) {
            setMembers(next);
          }
        },
        onStatus(next) {
          if (!disposed) {
            setStatus(next);
          }
        },
      },
      me ? { userId: me.id, name: me.name, isOwner: false } : undefined,
    ).then((ch) => {
      if (disposed) {
        void ch.unsubscribe();
        return;
      }
      channel = ch;
    });

    // Catch any edits made between the server render and the subscription.
    void resync();

    return () => {
      disposed = true;
      if (channel) {
        void channel.unsubscribe();
      }
      view.destroy();
      viewRef.current = null;
    };
    // Mounted once per document (remounted via key={document.id}).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{label}</h2>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <PresenceAvatars
            members={members.filter((member) => member.userId !== me?.id)}
          />
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <span
              className={
                status === "live"
                  ? "size-2 rounded-full bg-primary"
                  : status === "reconnecting"
                    ? "size-2 rounded-full bg-muted-foreground motion-safe:animate-pulse"
                    : "size-2 rounded-full bg-muted-foreground"
              }
            />
            Read-only · {STATUS_LABEL[status]}
          </span>
        </div>
      </div>
      <div ref={mountRef} className="mt-3 flex-1 overflow-auto" />
    </div>
  );
}
