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
import {
  sectionRedoCommand,
  sectionUndoCommand,
} from "@/lib/editor/section-undo";
import { marks, nodes } from "@/lib/editor/schema";
import { cn } from "@/lib/utils";

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
  scope = "page",
  trailing,
}: {
  className?: string;
  variant?: "card" | "bar";
  /** `"page"` (default) = page-level toolbar that acts on whichever editor is
   * focused. `"dialog"` = an instance rendered inside the blocks dialog;
   * formatting buttons are disabled until a dialog body is the active editor
   * (so the toolbar can't reach through the modal and edit the live doc
   * behind it), and the Note / Scripture buttons are hidden (they target the
   * notes_index / notes editor that the dialog body doesn't have). */
  scope?: "page" | "dialog";
  /** Extra controls pinned to the end of the bar (e.g. the group members menu). */
  trailing?: ReactNode;
}) {
  const ctx = useEditorContext();
  const [scriptureOpen, setScriptureOpen] = useState(false);

  if (!ctx) {
    return null;
  }
  const { activeState, runCommand, createNote, activeKind } = ctx;
  // In `scope="dialog"`, the toolbar is rendered inside the blocks dialog and
  // must only act on dialog-body editors — otherwise it would target the
  // underlying section editor through the modal overlay.
  const effectivelyDisabled =
    activeState === null || (scope === "dialog" && activeKind !== "dialog");
  // Notes anchor on the active view AND insert into the blocks doc's notes
  // index; Scripture inserts into the notes editor. Both are meaningless when
  // a dialog body is active, so they're hidden in dialog scope or when the
  // active editor is a dialog body.
  const allowDocSpecific = scope !== "dialog" && activeKind !== "dialog";

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
          {
            icon: Undo,
            label: "Undo",
            command: sectionUndoCommand,
            active: false,
          },
          {
            icon: Redo,
            label: "Redo",
            command: sectionRedoCommand,
            active: false,
          },
        ],
      ]
    : [];

  return (
    <div className={className}>
      <div
        // Whole-bar disabled treatment: when there's no editor to act on (or, in
        // dialog scope, when focus is in a plain textarea like the title /
        // subtitle / placeholder), the entire bar reads as "not usable right
        // now" — muted background + dropped opacity + pointer-events stripped —
        // rather than leaving a row of half-greyed icons over a normal bg.
        aria-disabled={effectivelyDisabled}
        className={cn(
          variant === "bar"
            ? "flex flex-wrap items-center gap-1 px-2 py-1.5"
            : "flex flex-wrap items-center gap-1 rounded-md border bg-card p-1",
          effectivelyDisabled
            ? "pointer-events-none bg-muted/60 opacity-60"
            : "",
        )}
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
                disabled={effectivelyDisabled}
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
        {allowDocSpecific ? (
          <>
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
          </>
        ) : null}
        {/* Cheatsheet / Group are page-level concerns (whole-section shortcuts,
            whole-group roster) and don't apply to a single block's body editor,
            so they're omitted from the dialog scope's preset. */}
        {scope !== "dialog" ? (
          <>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <ShortcutCheatsheet />
          </>
        ) : null}
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
