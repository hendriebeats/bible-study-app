"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { gapCursor } from "prosemirror-gapcursor";
import { closeHistory, history, redo, undo } from "prosemirror-history";
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  History,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo,
  Strikethrough,
  Undo,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EditorState } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";

import {
  appendSectionSteps,
  createSectionCheckpoint,
  renameSection,
} from "@/app/studies/actions";
import { VersionHistoryPanel } from "@/components/studies/version-history-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { Section, SectionHistory } from "@/lib/db/types";
import {
  isAncestorActive,
  isBlockActive,
  isMarkActive,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleHeading,
  toggleItalic,
  toggleOrderedList,
  toggleStrike,
} from "@/lib/editor/commands";
import { buildInputRules } from "@/lib/editor/plugins/input-rules";
import { buildKeymaps } from "@/lib/editor/plugins/keymap";
import { placeholder } from "@/lib/editor/plugins/placeholder";
import { marks, nodes, schema } from "@/lib/editor/schema";
import {
  docToJSON,
  jsonToDoc,
  jsonToStep,
  stepToJSON,
} from "@/lib/editor/serialize";
import type { PMDocJSON, SerializedStep } from "@/lib/editor/types";
import {
  broadcastCursor,
  broadcastSteps,
  openSectionChannel,
} from "@/lib/realtime/section-channel";

const AUTOSAVE_DELAY_MS = 1200;
/** Snapshot a checkpoint after this many new steps, to bound replay length. */
const CHECKPOINT_EVERY = 50;

type SaveStatus = "idle" | "saving" | "saved";

function createPlugins() {
  return [
    buildInputRules(),
    ...buildKeymaps(),
    gapCursor(),
    history(),
    placeholder("Start writing your study notes…"),
  ];
}

function initialDoc(content: PMDocJSON) {
  const doc = jsonToDoc(content);
  // Defensive: the schema requires at least one block; fall back to a paragraph.
  return doc.childCount > 0 ? doc : (schema.topNodeType.createAndFill() ?? doc);
}

/**
 * Rebuild the editor state with a usable undo stack: start from the base doc
 * (latest checkpoint) and replay the persisted steps as history-tracked
 * transactions, so Cmd-Z survives a page refresh back to that checkpoint.
 * `closeHistory` between persisted batches (different `created_at`) keeps undo
 * groups roughly at the granularity the edits were made. Any replay failure
 * falls back to the materialized head doc with no history (doc stays correct).
 */
function buildInitialState(bundle: SectionHistory, headContent: PMDocJSON) {
  try {
    let state = EditorState.create({
      doc: initialDoc(bundle.baseDoc),
      plugins: createPlugins(),
    });
    let prevCreatedAt: string | null = null;
    for (const row of bundle.steps) {
      let tr = state.tr;
      if (prevCreatedAt !== null && row.created_at !== prevCreatedAt) {
        tr = closeHistory(tr);
      }
      tr.step(jsonToStep(row.step));
      state = state.apply(tr);
      prevCreatedAt = row.created_at;
    }
    return state;
  } catch {
    return EditorState.create({
      doc: initialDoc(headContent),
      plugins: createPlugins(),
    });
  }
}

interface ToolbarItem {
  icon: LucideIcon;
  label: string;
  command: Command;
  active: boolean;
}

function Toolbar({
  state,
  onCommand,
}: {
  state: EditorState | null;
  onCommand: (command: Command) => void;
}) {
  if (!state) {
    return null;
  }

  const groups: ToolbarItem[][] = [
    [
      {
        icon: Bold,
        label: "Bold",
        command: toggleBold,
        active: isMarkActive(state, marks.strong),
      },
      {
        icon: Italic,
        label: "Italic",
        command: toggleItalic,
        active: isMarkActive(state, marks.em),
      },
      {
        icon: Strikethrough,
        label: "Strikethrough",
        command: toggleStrike,
        active: isMarkActive(state, marks.strikethrough),
      },
    ],
    [
      {
        icon: Heading1,
        label: "Heading 1",
        command: toggleHeading(1),
        active: isBlockActive(state, nodes.heading, { level: 1 }),
      },
      {
        icon: Heading2,
        label: "Heading 2",
        command: toggleHeading(2),
        active: isBlockActive(state, nodes.heading, { level: 2 }),
      },
      {
        icon: Heading3,
        label: "Heading 3",
        command: toggleHeading(3),
        active: isBlockActive(state, nodes.heading, { level: 3 }),
      },
    ],
    [
      {
        icon: List,
        label: "Bullet list",
        command: toggleBulletList,
        active: isAncestorActive(state, nodes.bulletList),
      },
      {
        icon: ListOrdered,
        label: "Numbered list",
        command: toggleOrderedList,
        active: isAncestorActive(state, nodes.orderedList),
      },
      {
        icon: Quote,
        label: "Quote",
        command: toggleBlockquote,
        active: isAncestorActive(state, nodes.blockquote),
      },
    ],
    [
      { icon: Undo, label: "Undo", command: undo, active: false },
      { icon: Redo, label: "Redo", command: redo, active: false },
    ],
  ];

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border bg-card p-1">
      {groups.map((group, index) => (
        <div key={group[0]?.label ?? index} className="flex items-center gap-1">
          {index > 0 ? (
            <Separator orientation="vertical" className="mx-1 h-6" />
          ) : null}
          {group.map((item) => (
            <Button
              key={item.label}
              type="button"
              size="icon"
              variant={item.active ? "secondary" : "ghost"}
              aria-label={item.label}
              aria-pressed={item.active}
              onClick={() => {
                onCommand(item.command);
              }}
            >
              <item.icon className="size-4" />
            </Button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SectionEditor({
  section,
  history: sectionHistory,
}: {
  section: Section;
  history: SectionHistory;
}) {
  const [title, setTitle] = useState(section.title);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyHead, setHistoryHead] = useState(0);
  const viewRef = useRef<EditorView | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persistence state (refs so the editor view's callbacks always see current
  // values without re-creating the view).
  const lastVersionRef = useRef(sectionHistory.headVersion);
  const lastCheckpointRef = useRef(sectionHistory.baseVersion);
  const pendingStepsRef = useRef<SerializedStep[]>([]);
  const flushingRef = useRef(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const clientId = crypto.randomUUID();
    // Broadcast this writer's steps + cursor to read-only viewers (read-along).
    let channel: RealtimeChannel | undefined;
    let disposed = false;
    void openSectionChannel(section.id, {}).then((ch) => {
      if (disposed) {
        void ch.unsubscribe();
        return;
      }
      channel = ch;
    });

    async function flush() {
      if (flushingRef.current || pendingStepsRef.current.length === 0) {
        return;
      }
      const view = viewRef.current;
      if (!view) {
        return;
      }
      flushingRef.current = true;
      const batch = pendingStepsRef.current;
      pendingStepsRef.current = [];
      const base = lastVersionRef.current;
      const newDoc = docToJSON(view.state.doc);
      try {
        const result = await appendSectionSteps(
          section.id,
          base,
          batch,
          newDoc,
          clientId,
        );
        if (!result.ok) {
          // Another writer advanced the doc — reload to resync from the head.
          window.location.reload();
          return;
        }
        lastVersionRef.current = result.version;
        setStatus("saved");
        // Push the persisted steps + the cursor's new position to viewers.
        if (channel) {
          broadcastSteps(channel, {
            base,
            steps: batch,
            version: result.version,
          });
          broadcastCursor(channel, {
            anchor: view.state.selection.anchor,
            head: view.state.selection.head,
            version: result.version,
          });
        }
        if (result.version - lastCheckpointRef.current >= CHECKPOINT_EVERY) {
          lastCheckpointRef.current = result.version;
          void createSectionCheckpoint(section.id).catch(() => undefined);
        }
      } catch {
        // Keep the steps and let the next change (or blur) retry.
        pendingStepsRef.current = [...batch, ...pendingStepsRef.current];
        setStatus("idle");
      } finally {
        flushingRef.current = false;
        if (pendingStepsRef.current.length > 0) {
          scheduleFlush();
        }
      }
    }

    function scheduleFlush() {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      saveTimer.current = setTimeout(() => {
        void flush();
      }, AUTOSAVE_DELAY_MS);
    }

    function flushNow() {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      void flush();
    }

    const view = new EditorView(mount, {
      state: buildInitialState(sectionHistory, section.content),
      dispatchTransaction(transaction) {
        const current = viewRef.current;
        if (!current) {
          return;
        }
        const next = current.state.apply(transaction);
        current.updateState(next);
        setEditorState(next);
        if (transaction.docChanged) {
          for (const step of transaction.steps) {
            pendingStepsRef.current.push(stepToJSON(step));
          }
          setStatus("saving");
          scheduleFlush();
        } else if (
          channel &&
          transaction.selectionSet &&
          pendingStepsRef.current.length === 0
        ) {
          // Cursor moved with no unsaved edits — its position is valid at the
          // confirmed head, so viewers can place it directly.
          broadcastCursor(channel, {
            anchor: next.selection.anchor,
            head: next.selection.head,
            version: lastVersionRef.current,
          });
        }
      },
      handleDOMEvents: {
        blur: () => {
          flushNow();
          return false;
        },
      },
    });
    viewRef.current = view;
    setEditorState(view.state);

    return () => {
      disposed = true;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      if (channel) {
        void channel.unsubscribe();
      }
      view.destroy();
      viewRef.current = null;
    };
    // Editor is created once per section (the route remounts via key={section.id}).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runCommand(command: Command) {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    command(view.state, view.dispatch, view);
    view.focus();
  }

  // Restore by replacing the whole doc with a past version — flows through the
  // normal step pipeline, so it's persisted, broadcast, and itself undoable.
  function applyRestore(targetDoc: PMDocJSON) {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const node = jsonToDoc(targetDoc);
    const tr = view.state.tr.replaceWith(
      0,
      view.state.doc.content.size,
      node.content,
    );
    if (tr.docChanged) {
      view.dispatch(tr);
    }
    setHistoryOpen(false);
    view.focus();
  }

  function handleTitleBlur() {
    const next = title.trim() || "Untitled section";
    if (next !== section.title) {
      void renameSection(section.id, section.study_id, next);
    }
  }

  const statusLabel =
    status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "";

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-3">
        <Input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          onBlur={handleTitleBlur}
          aria-label="Section title"
          className="h-auto border-0 bg-transparent px-0 text-2xl font-bold shadow-none focus-visible:ring-0"
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">{statusLabel}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setHistoryHead(lastVersionRef.current);
              setHistoryOpen(true);
            }}
          >
            <History className="size-4" />
            History
          </Button>
        </div>
      </div>
      <Toolbar state={editorState} onCommand={runCommand} />
      <div ref={mountRef} className="mt-4 flex-1 overflow-auto" />
      {historyOpen ? (
        <VersionHistoryPanel
          sectionId={section.id}
          headVersion={historyHead}
          onRestore={applyRestore}
          onClose={() => {
            setHistoryOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
