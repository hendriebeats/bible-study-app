"use client";

import {
  BookOpen,
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  MessageSquarePlus,
  Quote,
  Redo,
  Strikethrough,
  Underline,
  Undo,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Command } from "prosemirror-state";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { ColorControl } from "@/components/studies/color-control";
import { useEditorContext } from "@/components/studies/editor-context";
import { LinkControl } from "@/components/studies/link-control";
import { ScriptureInsertPanel } from "@/components/studies/scripture-insert-panel";
import { ShortcutCheatsheet } from "@/components/studies/shortcut-cheatsheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
  toggleUnderline,
} from "@/lib/editor/commands";
import { verseRedo, verseUndo } from "@/lib/editor/plugins/verse-guard";
import { marks, nodes } from "@/lib/editor/schema";

interface ToolbarItem {
  icon: LucideIcon;
  label: string;
  command: Command;
  active: boolean;
}

/**
 * The single formatting toolbar shared by a section's notes and study blocks.
 * It reads/acts on whichever editor is currently focused (via the editor
 * context) and routes "Add scripture" to the notes editor.
 *
 * `variant="bar"` drops the inner card chrome so the controls read as one flat
 * full-width strip (used by the studies top-bar toolbar row); `variant="card"`
 * keeps the bordered card look for standalone placements.
 */
export function EditorToolbar({
  className,
  variant = "card",
  trailing,
}: {
  className?: string;
  variant?: "card" | "bar";
  /** Extra controls pinned to the end of the bar (e.g. the group members menu). */
  trailing?: ReactNode;
}) {
  const ctx = useEditorContext();
  const [scriptureOpen, setScriptureOpen] = useState(false);

  if (!ctx) {
    return null;
  }
  const { activeState, runCommand, createNote } = ctx;

  function handleAddNote() {
    const result = createNote();
    if (!result.ok) {
      toast.info(result.error ?? "Select some text to add a note.");
    }
  }

  const groups: ToolbarItem[][] = activeState
    ? [
        [
          {
            icon: Bold,
            label: "Bold",
            command: toggleBold,
            active: isMarkActive(activeState, marks.strong),
          },
          {
            icon: Italic,
            label: "Italic",
            command: toggleItalic,
            active: isMarkActive(activeState, marks.em),
          },
          {
            icon: Underline,
            label: "Underline",
            command: toggleUnderline,
            active: isMarkActive(activeState, marks.underline),
          },
          {
            icon: Strikethrough,
            label: "Strikethrough",
            command: toggleStrike,
            active: isMarkActive(activeState, marks.strikethrough),
          },
        ],
        [
          {
            icon: Heading1,
            label: "Heading 1",
            command: toggleHeading(1),
            active: isBlockActive(activeState, nodes.heading, { level: 1 }),
          },
          {
            icon: Heading2,
            label: "Heading 2",
            command: toggleHeading(2),
            active: isBlockActive(activeState, nodes.heading, { level: 2 }),
          },
          {
            icon: Heading3,
            label: "Heading 3",
            command: toggleHeading(3),
            active: isBlockActive(activeState, nodes.heading, { level: 3 }),
          },
        ],
        [
          {
            icon: List,
            label: "Bullet list",
            command: toggleBulletList,
            active: isAncestorActive(activeState, nodes.bulletList),
          },
          {
            icon: ListOrdered,
            label: "Numbered list",
            command: toggleOrderedList,
            active: isAncestorActive(activeState, nodes.orderedList),
          },
          {
            icon: Quote,
            label: "Quote",
            command: toggleBlockquote,
            active: isAncestorActive(activeState, nodes.blockquote),
          },
        ],
        [
          { icon: Undo, label: "Undo", command: verseUndo, active: false },
          { icon: Redo, label: "Redo", command: verseRedo, active: false },
        ],
      ]
    : [];

  return (
    <div className={className}>
      <div
        className={
          variant === "bar"
            ? "flex flex-wrap items-center gap-1 px-2 py-1.5"
            : "flex flex-wrap items-center gap-1 rounded-md border bg-card p-1"
        }
      >
        {groups.map((group, index) => (
          <div
            key={group[0]?.label ?? index}
            className="flex items-center gap-1"
          >
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
                disabled={activeState === null}
                // Keep the editor focused (and its selection) when clicking.
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  runCommand(item.command);
                }}
              >
                <item.icon className="size-4" />
              </Button>
            ))}
          </div>
        ))}
        <Separator orientation="vertical" className="mx-1 h-6" />
        <LinkControl size="icon" />
        <ColorControl kind="highlight" size="icon" />
        <ColorControl kind="text" size="icon" />
        <Separator orientation="vertical" className="mx-1 h-6" />
        <Button
          type="button"
          size="sm"
          variant={scriptureOpen ? "secondary" : "ghost"}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            setScriptureOpen((open) => !open);
          }}
        >
          <BookOpen className="size-4" />
          Scripture
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={activeState === null}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={handleAddNote}
        >
          <MessageSquarePlus className="size-4" />
          Note
        </Button>
        <Separator orientation="vertical" className="mx-1 h-6" />
        <ShortcutCheatsheet />
        {trailing ? (
          <>
            <Separator orientation="vertical" className="mx-1 h-6" />
            {trailing}
          </>
        ) : null}
      </div>
      {scriptureOpen ? (
        <ScriptureInsertPanel
          onClose={() => {
            setScriptureOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
