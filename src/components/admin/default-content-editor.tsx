"use client";

import { gapCursor } from "prosemirror-gapcursor";
import { history } from "prosemirror-history";
import { Bold, Italic, List, ListOrdered, Strikethrough } from "lucide-react";
import { EditorState } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import { tableEditing } from "prosemirror-tables";
import { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
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
import { marks, nodes } from "@/lib/editor/schema";
import { docToJSON, jsonToDoc } from "@/lib/editor/serialize";
import type { PMNodeJSON } from "@/lib/editor/types";

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

/**
 * A compact rich-text editor for authoring a block template's default body
 * content. Reuses the shared schema + formatting commands; serializes to the
 * block-body shape (ProseMirror block nodes), reporting `null` when left empty.
 */
export function DefaultContentEditor({
  value,
  onChange,
}: {
  value: PMNodeJSON[] | null;
  onChange: (content: PMNodeJSON[] | null) => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const [editorState, setEditorState] = useState<EditorState | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }
    const view = new EditorView(mount, {
      state: EditorState.create({
        doc: initialDoc(value),
        plugins: [
          buildInputRules(),
          ...buildKeymaps(),
          gapCursor(),
          history(),
          tableEditing(),
        ],
      }),
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        setEditorState(next);
      },
      handleDOMEvents: {
        blur: () => {
          const content = docToJSON(view.state.doc).content ?? [];
          onChangeRef.current(isEmptyDoc(content) ? null : content);
          return false;
        },
      },
    });
    viewRef.current = view;
    setEditorState(view.state);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Created once; the row remounts on template id change.
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
    editorState === null
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
    <div className="rounded-md border bg-background">
      <div className="flex flex-wrap items-center gap-1 border-b p-1">
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
      <div ref={mountRef} className="px-3 py-2 text-sm" />
    </div>
  );
}
