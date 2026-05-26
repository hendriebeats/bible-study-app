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
  Quote,
  Redo,
  Strikethrough,
  Undo,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Command } from "prosemirror-state";
import { useState } from "react";
import { toast } from "sonner";

import { useEditorContext } from "@/components/studies/editor-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
 * The single, sticky formatting toolbar shared by a section's notes and study
 * blocks. It reads/acts on whichever editor is currently focused (via the
 * editor context) and routes "Add scripture" to the notes editor.
 */
export function EditorToolbar({ className }: { className?: string }) {
  const ctx = useEditorContext();
  const [scriptureOpen, setScriptureOpen] = useState(false);
  const [scriptureRef, setScriptureRef] = useState("");
  const [scriptureBusy, setScriptureBusy] = useState(false);

  if (!ctx) {
    return null;
  }
  const { activeState, runCommand, insertScripture } = ctx;

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

  async function submitScripture() {
    const reference = scriptureRef.trim();
    if (reference === "") {
      return;
    }
    setScriptureBusy(true);
    const result = await insertScripture(reference);
    setScriptureBusy(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't add that passage.");
      return;
    }
    setScriptureRef("");
    setScriptureOpen(false);
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1 rounded-md border bg-card p-1">
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
      </div>
      {scriptureOpen ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={scriptureRef}
            onChange={(event) => {
              setScriptureRef(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitScripture();
              }
            }}
            placeholder="e.g. John 3:1-21"
            aria-label="Scripture reference"
            className="h-8 max-w-xs"
            autoFocus
          />
          <Button
            type="button"
            size="sm"
            disabled={scriptureBusy}
            onClick={() => {
              void submitScripture();
            }}
          >
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setScriptureOpen(false);
              setScriptureRef("");
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
