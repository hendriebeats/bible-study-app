"use client";

import { gapCursor } from "prosemirror-gapcursor";
import { history, redo, undo } from "prosemirror-history";
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
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

import { renameSection, saveSection } from "@/app/studies/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { Section } from "@/lib/db/types";
import {
  isAncestorActive,
  isBlockActive,
  isMarkActive,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleItalic,
  toggleHeading,
  toggleOrderedList,
  toggleStrike,
} from "@/lib/editor/commands";
import { buildInputRules } from "@/lib/editor/plugins/input-rules";
import { buildKeymaps } from "@/lib/editor/plugins/keymap";
import { placeholder } from "@/lib/editor/plugins/placeholder";
import { marks, nodes, schema } from "@/lib/editor/schema";
import { docToJSON, jsonToDoc } from "@/lib/editor/serialize";
import type { PMDocJSON } from "@/lib/editor/types";

const AUTOSAVE_DELAY_MS = 1200;

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
  // The stored default {"type":"doc","content":[]} is empty, but the schema
  // requires at least one block — fall back to a single empty paragraph.
  return doc.childCount > 0 ? doc : (schema.topNodeType.createAndFill() ?? doc);
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

export function SectionEditor({ section }: { section: Section }) {
  const [title, setTitle] = useState(section.title);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    function persist(doc: PMDocJSON) {
      void saveSection(section.id, doc)
        .then(() => {
          setStatus("saved");
        })
        .catch(() => {
          setStatus("idle");
        });
    }

    function scheduleSave(doc: PMDocJSON) {
      setStatus("saving");
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      saveTimer.current = setTimeout(() => {
        persist(doc);
      }, AUTOSAVE_DELAY_MS);
    }

    function flushSave() {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const view = viewRef.current;
      if (view) {
        persist(docToJSON(view.state.doc));
      }
    }

    const view = new EditorView(mount, {
      state: EditorState.create({
        doc: initialDoc(section.content),
        plugins: createPlugins(),
      }),
      dispatchTransaction(transaction) {
        const current = viewRef.current;
        if (!current) {
          return;
        }
        const next = current.state.apply(transaction);
        current.updateState(next);
        setEditorState(next);
        if (transaction.docChanged) {
          // Persist on blur so navigating away never loses edits.
          scheduleSave(docToJSON(next.doc));
        }
      },
      handleDOMEvents: {
        blur: () => {
          flushSave();
          return false;
        },
      },
    });
    viewRef.current = view;
    setEditorState(view.state);

    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
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
        <span className="shrink-0 text-xs text-muted-foreground">
          {statusLabel}
        </span>
      </div>
      <Toolbar state={editorState} onCommand={runCommand} />
      <div ref={mountRef} className="mt-4 flex-1 overflow-auto" />
    </div>
  );
}
