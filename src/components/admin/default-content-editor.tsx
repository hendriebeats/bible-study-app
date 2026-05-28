"use client";

import { gapCursor } from "prosemirror-gapcursor";
import { history } from "prosemirror-history";
import { Bold, Italic, List, ListOrdered, Strikethrough } from "lucide-react";
import { EditorState } from "prosemirror-state";
import type { Command, Plugin } from "prosemirror-state";
import { tableEditing } from "prosemirror-tables";
import { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";

import {
  type EditorRole,
  useEditorContext,
} from "@/components/studies/editor-context";
import { Button } from "@/components/ui/button";
import { buildNodeViews } from "@/lib/editor/node-views";
import {
  isAncestorActive,
  isMarkActive,
  toggleBold,
  toggleBulletList,
  toggleItalic,
  toggleOrderedList,
  toggleStrike,
} from "@/lib/editor/commands";
import { buildInputRules } from "@/lib/editor/plugins/input-rules";
import { buildKeymaps } from "@/lib/editor/plugins/keymap";
import { placeholder as placeholderPlugin } from "@/lib/editor/plugins/placeholder";
import { slashMenu } from "@/lib/editor/plugins/slash-menu";
import { verseGuard } from "@/lib/editor/plugins/verse-guard";
import { verseLabel } from "@/lib/editor/plugins/verse-label";
import { marks, nodes } from "@/lib/editor/schema";
import { docToJSON, jsonToDoc } from "@/lib/editor/serialize";
import type { PMNodeJSON } from "@/lib/editor/types";
import { cn } from "@/lib/utils";
import { UNDO_GROUP_DELAY_MS, withUndoBoundary } from "@/lib/editor/word-undo";

function initialDoc(content: PMNodeJSON[] | null) {
  return jsonToDoc({
    type: "doc",
    content: content && content.length > 0 ? content : [{ type: "paragraph" }],
  });
}

/** A single empty paragraph means "no default content". */
function isEmptyDoc(content: PMNodeJSON[]): boolean {
  if (content.length !== 1) {
    return false;
  }
  const only = content[0];
  return only?.type === "paragraph" && (only.content?.length ?? 0) === 0;
}

/** Plugin set for the "host" mode (admin BlockTemplateEditor) — minimal. */
function hostPlugins(placeholderText: string): Plugin[] {
  return [
    buildInputRules(),
    ...buildKeymaps(),
    gapCursor(),
    history({ newGroupDelay: UNDO_GROUP_DELAY_MS }),
    tableEditing(),
    placeholderPlugin(placeholderText),
  ];
}

/** Plugin set for "dialog" mode (study-blocks dialog) — matches the main blocks
 *  editor so input rules (`[ ] ` → checklist, `# ` → heading, etc.), keymaps,
 *  slash menu, and verse handling all behave identically to in-page editing.
 *  Omits document-shape guards that don't apply to a single-block body editor:
 *  notesIndexGuard, blocksStructureGuard, blocksSelectionGuard, blockHandle,
 *  noteAnchors — and the section-wide undo coordinator. */
function dialogPlugins(placeholderText: string): Plugin[] {
  return [
    buildInputRules(),
    ...buildKeymaps(),
    gapCursor(),
    history({ newGroupDelay: UNDO_GROUP_DELAY_MS }),
    verseGuard(),
    verseLabel(),
    slashMenu(),
    tableEditing(),
    placeholderPlugin(placeholderText),
  ];
}

/**
 * A compact rich-text editor for a block's body content.
 *
 * Two modes:
 *   - default ("host"): a self-contained card with its own mini toolbar
 *     (B/I/S/lists). Used by the admin template editor.
 *   - `editorRole="dialog"`: the editor registers with the shared
 *     `EditorContext` and uses the same plugin set as the main blocks editor
 *     (slash menu, full input rules, verse handling). Drops the per-card
 *     toolbar — the dialog's single top toolbar acts on whichever body is
 *     focused. Matches the on-page editing experience.
 *
 * `placeholder` text renders as ghost text inside the empty body (matching the
 * main blocks editor's per-block placeholder). The text is captured at mount —
 * remount (re-key) to update it. `bare` drops the outer card chrome so the
 * editor visually integrates into a host container.
 */
export function DefaultContentEditor({
  value,
  onChange,
  placeholder = "",
  bare = false,
  editorRole,
}: {
  value: PMNodeJSON[] | null;
  onChange: (content: PMNodeJSON[] | null) => void;
  placeholder?: string;
  bare?: boolean;
  /** When set, register with the shared `EditorContext` under this role so the
   * page-level toolbar + selection bubble act on this editor when focused. */
  editorRole?: EditorRole;
}) {
  const editor = useEditorContext();
  // The context value's identity changes on every selection/edit; keep a ref so
  // the once-only EditorView effect doesn't capture a stale snapshot.
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });

  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const isDialog = editorRole === "dialog";
  // Internal toolbar is for the standalone (admin) mode only — when the editor
  // is registered with the shared context, the page toolbar handles formatting.
  const showInternalToolbar = editorRole === undefined;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }
    const view = new EditorView(mount, {
      state: EditorState.create({
        doc: initialDoc(value),
        plugins: isDialog
          ? dialogPlugins(placeholder)
          : hostPlugins(placeholder),
      }),
      // Same NodeView set as the main editor so checkboxes, callouts, etc. all
      // render with their custom views (TaskItemView, etc.) — fixes the `[ ] `
      // checkbox glitch where the schema node existed but had no view.
      nodeViews: isDialog ? buildNodeViews(true) : undefined,
      dispatchTransaction(incoming) {
        const tr = withUndoBoundary(view, incoming);
        const next = view.state.apply(tr);
        view.updateState(next);
        setEditorState(next);
        if (isDialog) {
          editorRef.current?.setActive(view, next);
        }
      },
      handleDOMEvents: {
        focus: () => {
          if (isDialog) {
            const current = viewRef.current;
            if (current) {
              editorRef.current?.setActive(current, current.state);
            }
          }
          return false;
        },
        blur: () => {
          const content = docToJSON(view.state.doc).content ?? [];
          onChangeRef.current(isEmptyDoc(content) ? null : content);
          return false;
        },
      },
    });
    viewRef.current = view;
    setEditorState(view.state);
    if (isDialog) {
      editorRef.current?.registerView(view, "dialog");
    }
    return () => {
      if (isDialog) {
        editorRef.current?.unregisterView(view);
      }
      view.destroy();
      viewRef.current = null;
    };
    // Created once; the row remounts on key change (placeholder/key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function run(command: Command) {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    command(view.state, view.dispatch, view);
    view.focus();
  }

  const items =
    !showInternalToolbar || editorState === null
      ? []
      : [
          {
            icon: Bold,
            label: "Bold",
            command: toggleBold,
            active: isMarkActive(editorState, marks.strong),
          },
          {
            icon: Italic,
            label: "Italic",
            command: toggleItalic,
            active: isMarkActive(editorState, marks.em),
          },
          {
            icon: Strikethrough,
            label: "Strikethrough",
            command: toggleStrike,
            active: isMarkActive(editorState, marks.strikethrough),
          },
          {
            icon: List,
            label: "Bullet list",
            command: toggleBulletList,
            active: isAncestorActive(editorState, nodes.bulletList),
          },
          {
            icon: ListOrdered,
            label: "Numbered list",
            command: toggleOrderedList,
            active: isAncestorActive(editorState, nodes.orderedList),
          },
        ];

  return (
    <div className={cn(bare ? "" : "rounded-md border bg-background")}>
      {showInternalToolbar ? (
        <div
          className={cn(
            "flex flex-wrap items-center gap-1 p-1",
            bare ? "" : "border-b",
          )}
        >
          {items.map((item) => (
            <Button
              key={item.label}
              type="button"
              size="icon"
              variant={item.active ? "secondary" : "ghost"}
              aria-label={item.label}
              aria-pressed={item.active}
              onClick={() => {
                run(item.command);
              }}
            >
              <item.icon className="size-4" />
            </Button>
          ))}
        </div>
      ) : null}
      <div ref={mountRef} className="px-3 py-2 text-sm" />
    </div>
  );
}
