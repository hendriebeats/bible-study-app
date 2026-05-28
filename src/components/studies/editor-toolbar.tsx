"use client";

import {
  BookOpen,
  Bold,
  ChevronDown,
  CircleCheck,
  FileImage,
  Heading1,
  Heading2,
  Heading3,
  Heart,
  Image as ImageIcon,
  Info,
  Italic,
  Lightbulb,
  List,
  ListChecks,
  ListOrdered,
  MessageSquarePlus,
  PanelTopOpen,
  Quote,
  Redo,
  Sparkles,
  Strikethrough,
  Table as TableIcon,
  TriangleAlert,
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
import { ZoomControl } from "@/components/studies/zoom-control";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  insertCallout,
  insertCollapsible,
  insertTable,
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
  toggleTaskList,
  toggleUnderline,
} from "@/lib/editor/commands";
import type { EditorToolKey, EditorTools } from "@/lib/editor/editor-tools";
import {
  sectionRedoCommand,
  sectionUndoCommand,
} from "@/lib/editor/section-undo";
import { marks, nodes } from "@/lib/editor/schema";
import { modKey, useIsMac } from "@/lib/platform";
import { cn } from "@/lib/utils";

/** A plain icon button entry: dispatches `command` against the active editor. */
interface ToolbarButton {
  kind: "button";
  icon: LucideIcon;
  label: string;
  command: Command;
  active: boolean;
  /** Keyboard shortcut hint ("⌘B"). Already resolved for the current platform. */
  shortcut?: string;
  /** Markdown syntax hint ("**text**", "# ", "- "). */
  markdown?: string;
  /** Render but disable + label as "Coming soon" — gives a slot to features
   * that aren't wired into the editor yet. */
  comingSoon?: boolean;
}

/** Inert leaf: a custom component (LinkControl, ColorControl, CalloutMenu, ZoomControl…). */
interface ToolbarSlot {
  kind: "slot";
  key: string;
  node: ReactNode;
}

type ToolbarEntry = ToolbarButton | ToolbarSlot;

/**
 * One toolbar group. Visually separated from neighbouring groups by a vertical
 * rule — but only when both sides have content (so an opt-in-gated empty
 * group never leaves an orphan separator).
 */
interface ToolbarGroup {
  id: string;
  entries: ToolbarEntry[];
}

/**
 * The single formatting toolbar shared by a section's notes and study blocks.
 * It reads/acts on whichever editor is currently focused (via the editor
 * context) and routes "Add scripture" to the notes editor.
 *
 * Group order (Google-Docs-like): undo/redo + zoom · text marks · structure
 * (headings, lists, collapsible, quote) · doc-specific (link, note, scripture)
 * · insert blocks (callouts, table, image, media) · trailing (group menu).
 *
 * Every actionable entry carries a hover tooltip with the label + keyboard
 * shortcut + markdown syntax where available, so the bar is self-teaching
 * without consulting the cheatsheet.
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
  const isMac = useIsMac();
  const [scriptureOpen, setScriptureOpen] = useState(false);

  if (!ctx) {
    return null;
  }
  const { activeState, runCommand, createNote, activeKind, editorTools } = ctx;
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

  // Only assemble the formatting groups once there's an editor state — without
  // one we'd render a row of permanently-disabled icons over a normal bg.
  const groups: ToolbarGroup[] = activeState
    ? buildGroups({
        activeState,
        allowDocSpecific,
        scriptureOpen,
        onToggleScripture: () => {
          setScriptureOpen((open) => !open);
        },
        onAddNote: handleAddNote,
        editorTools,
        mod: modKey(isMac),
      })
    : [];

  // Drop entirely-empty groups so an opt-in-gated empty group can't leave an
  // orphan separator behind it.
  const visibleGroups = groups.filter((group) => group.entries.length > 0);

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
        {visibleGroups.map((group, groupIndex) => (
          <div key={group.id} className="flex items-center gap-1">
            {groupIndex > 0 ? (
              <Separator orientation="vertical" className="mx-1 h-6" />
            ) : null}
            {group.entries.map((entry) =>
              entry.kind === "slot" ? (
                <span key={entry.key}>{entry.node}</span>
              ) : (
                <ToolbarIconButton
                  key={entry.label}
                  entry={entry}
                  disabled={effectivelyDisabled}
                  onRun={runCommand}
                />
              ),
            )}
          </div>
        ))}
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

/**
 * One toolbar icon button. Wrapped in a Tooltip so hover surfaces the label,
 * keyboard shortcut, and markdown syntax (when applicable) without forcing the
 * user into the cheatsheet.
 */
function ToolbarIconButton({
  entry,
  disabled,
  onRun,
}: {
  entry: ToolbarButton;
  disabled: boolean;
  onRun: (command: Command) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant={entry.active ? "secondary" : "ghost"}
          aria-label={
            entry.comingSoon ? `${entry.label} (coming soon)` : entry.label
          }
          aria-pressed={entry.active}
          disabled={disabled || entry.comingSoon === true}
          // Keep the editor focused (and its selection) when clicking.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            onRun(entry.command);
          }}
        >
          <entry.icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <ToolbarTooltipBody entry={entry} />
      </TooltipContent>
    </Tooltip>
  );
}

/** Tooltip text: label on top, shortcut (and/or markdown) on hint lines below. */
function ToolbarTooltipBody({ entry }: { entry: ToolbarButton }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-medium">
        {entry.label}
        {entry.comingSoon ? (
          <span className="ml-1 opacity-70">(coming soon)</span>
        ) : null}
      </span>
      {entry.shortcut ? (
        <span className="font-mono text-xs opacity-70">{entry.shortcut}</span>
      ) : null}
      {entry.markdown ? (
        <span className="font-mono text-xs opacity-70">{entry.markdown}</span>
      ) : null}
    </div>
  );
}

/**
 * Wrap any custom slot trigger (DropdownMenuTrigger, ColorControl, etc.) in
 * a tooltip. Used by the inline Note / Scripture / Callout buttons; the
 * `ZoomControl` / `LinkControl` / `ColorControl` components carry their own.
 */
function SlotTooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col items-center gap-0.5">
          <span className="font-medium">{label}</span>
          {shortcut ? (
            <span className="font-mono text-xs opacity-70">{shortcut}</span>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** Build the ordered toolbar groups for the current editor state + tools. */
function buildGroups({
  activeState,
  allowDocSpecific,
  scriptureOpen,
  onToggleScripture,
  onAddNote,
  editorTools,
  mod,
}: {
  activeState: NonNullable<ReturnType<typeof useEditorContext>>["activeState"];
  allowDocSpecific: boolean;
  scriptureOpen: boolean;
  onToggleScripture: () => void;
  onAddNote: () => void;
  editorTools: EditorTools;
  /** Pre-resolved modifier glyph (⌘ on macOS, Ctrl elsewhere). */
  mod: string;
}): ToolbarGroup[] {
  if (!activeState) {
    return [];
  }

  // Group 1 — history + zoom. Slots first so the very first thing the user
  // sees is Undo/Redo (Google-Docs-style).
  const history: ToolbarGroup = {
    id: "history",
    entries: [
      {
        kind: "button",
        icon: Undo,
        label: "Undo",
        command: sectionUndoCommand,
        active: false,
        shortcut: `${mod} Z`,
      },
      {
        kind: "button",
        icon: Redo,
        label: "Redo",
        command: sectionRedoCommand,
        active: false,
        shortcut: `${mod} ⇧ Z`,
      },
      { kind: "slot", key: "zoom", node: <ZoomControl /> },
    ],
  };

  // Group 2 — text marks + colour. The two `ColorControl`s are slots because
  // they own their own popover/active-state logic (and tooltips). Strikethrough
  // is gated on the `strikethrough` opt-in tool — when off, the button drops
  // out of the group entirely (the keymap + input-rules drop their handlers
  // too, see plugins/keymap.ts and plugins/input-rules.ts).
  const marksEntries: ToolbarEntry[] = [
    {
      kind: "button",
      icon: Bold,
      label: "Bold",
      command: toggleBold,
      active: isMarkActive(activeState, marks.strong),
      shortcut: `${mod} B`,
      markdown: "**text**",
    },
    {
      kind: "button",
      icon: Italic,
      label: "Italic",
      command: toggleItalic,
      active: isMarkActive(activeState, marks.em),
      shortcut: `${mod} I`,
      markdown: "*text*",
    },
    {
      kind: "button",
      icon: Underline,
      label: "Underline",
      command: toggleUnderline,
      active: isMarkActive(activeState, marks.underline),
      shortcut: `${mod} U`,
    },
  ];
  if (editorTools.strikethrough) {
    marksEntries.push({
      kind: "button",
      icon: Strikethrough,
      label: "Strikethrough",
      command: toggleStrike,
      active: isMarkActive(activeState, marks.strikethrough),
      shortcut: `${mod} ⇧ S`,
      markdown: "~~text~~",
    });
  }
  marksEntries.push(
    {
      kind: "slot",
      key: "text-color",
      node: <ColorControl kind="text" size="icon" />,
    },
    {
      kind: "slot",
      key: "highlight-color",
      node: <ColorControl kind="highlight" size="icon" />,
    },
  );
  const marksGroup: ToolbarGroup = { id: "marks", entries: marksEntries };

  // Group 3 — block-level structure (headings, lists, collapsible, quote).
  // Collapsible sits next to Checklist because it's a structural container,
  // not an "insert" — it shapes how content is organized, like a list does.
  // The three heading buttons are a single feature ("Headings" toggle on the
  // account page) — when off, they drop out together, not one at a time.
  const structureEntries: ToolbarEntry[] = [];
  if (editorTools.headings) {
    structureEntries.push(
      {
        kind: "button",
        icon: Heading1,
        label: "Heading 1",
        command: toggleHeading(1),
        active: isBlockActive(activeState, nodes.heading, { level: 1 }),
        markdown: "# ",
      },
      {
        kind: "button",
        icon: Heading2,
        label: "Heading 2",
        command: toggleHeading(2),
        active: isBlockActive(activeState, nodes.heading, { level: 2 }),
        markdown: "## ",
      },
      {
        kind: "button",
        icon: Heading3,
        label: "Heading 3",
        command: toggleHeading(3),
        active: isBlockActive(activeState, nodes.heading, { level: 3 }),
        markdown: "### ",
      },
    );
  }
  structureEntries.push(
    {
      kind: "button",
      icon: List,
      label: "Bullet list",
      command: toggleBulletList,
      active: isAncestorActive(activeState, nodes.bulletList),
      markdown: "- or *",
    },
    {
      kind: "button",
      icon: ListOrdered,
      label: "Numbered list",
      command: toggleOrderedList,
      active: isAncestorActive(activeState, nodes.orderedList),
      markdown: "1.",
    },
    {
      kind: "button",
      icon: ListChecks,
      label: "Checklist",
      command: toggleTaskList,
      active: isAncestorActive(activeState, nodes.taskList),
      markdown: "- [ ]",
    },
  );
  if (editorTools.collapsibles) {
    structureEntries.push({
      kind: "button",
      icon: PanelTopOpen,
      label: "Collapsible section",
      command: insertCollapsible,
      active: false,
    });
  }
  structureEntries.push({
    kind: "button",
    icon: Quote,
    label: "Quote",
    command: toggleBlockquote,
    active: isAncestorActive(activeState, nodes.blockquote),
    markdown: "> ",
  });
  const structure: ToolbarGroup = {
    id: "structure",
    entries: structureEntries,
  };

  // Group 4 — doc-specific actions: Link (gated on the `links` opt-in tool),
  // Note (anchors on selection, body lives in the blocks doc), Scripture
  // (inserts into notes). Note + Scripture are hidden in dialog scope (no
  // notes_index/notes available).
  const docSpecific: ToolbarGroup = { id: "doc-specific", entries: [] };
  if (editorTools.links) {
    docSpecific.entries.push({
      kind: "slot",
      key: "link",
      node: <LinkControl size="icon" />,
    });
  }
  if (allowDocSpecific) {
    docSpecific.entries.push(
      {
        kind: "slot",
        key: "note",
        node: (
          <SlotTooltip label="Add note">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Add note"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={onAddNote}
            >
              <MessageSquarePlus className="size-4" />
            </Button>
          </SlotTooltip>
        ),
      },
      {
        kind: "slot",
        key: "scripture",
        node: (
          <SlotTooltip label="Insert scripture">
            <Button
              type="button"
              size="icon"
              variant={scriptureOpen ? "secondary" : "ghost"}
              aria-label="Insert scripture"
              aria-pressed={scriptureOpen}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={onToggleScripture}
            >
              <BookOpen className="size-4" />
            </Button>
          </SlotTooltip>
        ),
      },
    );
  }

  // Group 5 — insertable blocks. Each entry is tool-gated: if the user hasn't
  // opted into it in Account → Editor tools the entry simply isn't in the
  // group (the same gating slash-menu uses). Image + Media are not yet wired
  // into the editor; they're shown as `comingSoon` slots so the toolbar has a
  // permanent home for them — when the feature ships, swap in a real command.
  const inserts: ToolbarGroup = { id: "inserts", entries: [] };
  if (editorTools.callouts) {
    inserts.entries.push({
      kind: "slot",
      key: "callout-menu",
      node: <CalloutMenu />,
    });
  }
  if (editorTools.tables) {
    inserts.entries.push({
      kind: "button",
      icon: TableIcon,
      label: "Table",
      command: insertTable,
      active: false,
    });
  }
  if (showComingSoon(editorTools, "images")) {
    inserts.entries.push({
      kind: "button",
      icon: ImageIcon,
      label: "Image",
      command: noopCommand,
      active: false,
      comingSoon: true,
    });
  }
  if (showComingSoon(editorTools, "mediaEmbeds")) {
    inserts.entries.push({
      kind: "button",
      icon: FileImage,
      label: "Video or audio",
      command: noopCommand,
      active: false,
      comingSoon: true,
    });
  }

  return [history, marksGroup, structure, docSpecific, inserts];
}

/**
 * Show the coming-soon placeholder when the user has opted into the tool
 * (i.e. they know it's planned) — keeps the bar tight for users who haven't.
 * If we later decide everyone should see "coming soon" icons, return true.
 */
function showComingSoon(tools: EditorTools, key: EditorToolKey): boolean {
  return tools[key];
}

/** Inert command for `comingSoon` placeholders — they're rendered disabled. */
const noopCommand: Command = () => false;

/**
 * The five callout variants share a single dropdown to keep the inserts group
 * compact. Each item dispatches `insertCallout(variant)` which replaces the
 * current empty block or inserts after the current block (see
 * `commands.ts:insertCallout`).
 */
function CalloutMenu() {
  const ctx = useEditorContext();
  const variants: { key: string; label: string; icon: LucideIcon }[] = [
    { key: "note", label: "Note", icon: Info },
    { key: "insight", label: "Key insight", icon: Lightbulb },
    { key: "warning", label: "Warning", icon: TriangleAlert },
    { key: "prayer", label: "Prayer", icon: Heart },
    { key: "application", label: "Application", icon: CircleCheck },
  ];
  return (
    <DropdownMenu>
      <SlotTooltip label="Insert callout">
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Insert callout"
            // Keep editor focused/selection intact when opening the menu.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            className="relative"
          >
            <Sparkles className="size-4" />
            <ChevronDown className="absolute right-0.5 bottom-0.5 size-2.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
      </SlotTooltip>
      <DropdownMenuContent align="start">
        {variants.map((variant) => {
          const Icon = variant.icon;
          return (
            <DropdownMenuItem
              key={variant.key}
              onSelect={() => {
                ctx?.runCommand(insertCallout(variant.key));
              }}
            >
              <Icon className="size-4" />
              {variant.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
