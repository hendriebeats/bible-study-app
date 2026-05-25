"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";

import { fetchSectionHead } from "@/app/studies/actions";
import type { Section } from "@/lib/db/types";
import {
  remoteCursor,
  remoteCursorKey,
} from "@/lib/editor/plugins/remote-cursor";
import { schema } from "@/lib/editor/schema";
import { jsonToDoc, jsonToStep } from "@/lib/editor/serialize";
import type { PMDocJSON } from "@/lib/editor/types";
import { openSectionChannel } from "@/lib/realtime/section-channel";

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

/**
 * Read-only live view of a section a co-member doesn't own. Mirrors the
 * writer's edits and cursor via Supabase Realtime; the editor isn't editable.
 */
export function SectionViewer({ section }: { section: Section }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const versionRef = useRef(section.current_version);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const view = new EditorView(mount, {
      state: viewerState(section.content),
      editable: () => false,
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
      const head = await fetchSectionHead(section.id);
      const current = viewRef.current;
      if (!head || !current) {
        return;
      }
      current.updateState(viewerState(head.content));
      versionRef.current = head.version;
    }

    let channel: RealtimeChannel | undefined;
    let disposed = false;
    void openSectionChannel(section.id, {
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
      onCursor({ anchor, head }) {
        const current = viewRef.current;
        if (current) {
          current.dispatch(
            current.state.tr.setMeta(remoteCursorKey, { anchor, head }),
          );
        }
      },
    }).then((ch) => {
      if (disposed) {
        void ch.unsubscribe();
        return;
      }
      channel = ch;
      setConnected(true);
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
    // Mounted once per section (route remounts via key={section.id}).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-2xl font-bold">{section.title}</h1>
        <span className="shrink-0 text-xs text-muted-foreground">
          {connected ? "Read-only · live" : "Read-only"}
        </span>
      </div>
      <div ref={mountRef} className="mt-4 flex-1 overflow-auto" />
    </div>
  );
}
