"use client";

import {
  Bold,
  FileImage,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Megaphone,
  MessageSquarePlus,
  PanelTopOpen,
  Quote,
  Redo,
  Strikethrough,
  Table as TableIcon,
  Underline,
  Undo,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Command } from "prosemirror-state";
import { type ReactNode } from "react";
import { toast } from "sonner";

import { ColorControl } from "@/components/studies/color-control";
import { useEditorContext } from "@/components/studies/editor-context";
import { LinkControl } from "@/components/studies/link-control";
import { ScriptureControl } from "@/components/studies/scripture-insert-panel";
import { ZoomControl } from "@/components/studies/zoom-control";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  indentSelected,
  insertCallout,
  insertCollapsible,
  insertTable,
  isAncestorActive,
  isBlockActive,
  isListRowActive,
  isMarkActive,
  outdentSelected,
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
  canSectionRedo,
  canSectionUndo,
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
  /** Per-button disable, OR-ed with the whole-toolbar disable. Used by Undo /
   * Redo to gray out when there's nothing to undo / redo in the active state. */
  disabled?: boolean;
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
 * Group order: undo/redo + zoom · text marks (ending in highlight) · headings
 * (H1/H2/H3) · lists (bullet/ordered/checklist + collapsible) · indent pair ·
 * link + quote + callout + table · doc-specific (note, scripture) · media
 * inserts (image, media) · trailing (group menu).
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

  if (!ctx) {
    return null;
  }
  // `scriptureOpen` lives in the editor context so the empty-owner Study Body
  // overlay (in `DocumentEditor`) can open the same popover by toggling the
  // context flag. The Scripture button + popover itself is `ScriptureControl`,
  // which reads the flag from context directly — the toolbar no longer
  // forwards it.
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
            ? "flex flex-wrap items-center gap-1 px-2 py-0.5"
            : "flex flex-wrap items-center gap-1 rounded-md border bg-card p-1",
          effectivelyDisabled
            ? "pointer-events-none bg-muted/60 opacity-60"
            : "",
        )}
      >
        {visibleGroups.map((group, groupIndex) => (
          <div key={group.id} className="flex items-center gap-1">
            {groupIndex > 0 ? (
              <Separator
                orientation="vertical"
                className="mx-1 h-6 self-center"
              />
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
            <Separator
              orientation="vertical"
              className="mx-1 h-6 self-center"
            />
            {trailing}
          </>
        ) : null}
      </div>
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
          disabled={
            disabled || entry.comingSoon === true || entry.disabled === true
          }
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
  onAddNote,
  editorTools,
  mod,
}: {
  activeState: NonNullable<ReturnType<typeof useEditorContext>>["activeState"];
  allowDocSpecific: boolean;
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
        // Gray out when nothing's undoable — checks both the section-wide stack
        // and the active editor's local history.
        disabled: !canSectionUndo(activeState),
      },
      {
        kind: "button",
        icon: Redo,
        label: "Redo",
        command: sectionRedoCommand,
        active: false,
        shortcut: `${mod} ⇧ Z`,
        disabled: !canSectionRedo(activeState),
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

  // Group 3 — list-shaped containers: bullets, ordered, checklist, plus the
  // collapsible (which is structurally a list-like row of one item with a
  // collapsible body, so it slots next to checklist).
  const listsEntries: ToolbarEntry[] = [
    {
      kind: "button",
      icon: List,
      label: "Bullet list",
      command: toggleBulletList,
      active: isListRowActive(activeState, "bullet"),
      markdown: "- or *",
    },
    {
      kind: "button",
      icon: ListOrdered,
      label: "Numbered list",
      command: toggleOrderedList,
      active: isListRowActive(activeState, "ordered"),
      markdown: "1.",
    },
    {
      kind: "button",
      icon: ListChecks,
      label: "Checklist",
      command: toggleTaskList,
      active: isListRowActive(activeState, "task"),
      markdown: "- [ ]",
    },
  ];
  if (editorTools.collapsibles) {
    listsEntries.push({
      kind: "button",
      icon: PanelTopOpen,
      label: "Collapsible section",
      command: insertCollapsible,
      active: false,
    });
  }
  const lists: ToolbarGroup = { id: "lists", entries: listsEntries };

  // Group 4 — headings (H1/H2/H3). One opt-in (`headings`) controls all three.
  const headings: ToolbarGroup = { id: "headings", entries: [] };
  if (editorTools.headings) {
    headings.entries.push(
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

  // Group 5 — indent / outdent. Tab and Shift-Tab equivalents, sized as one
  // standalone pair so they don't get lost inside the lists group.
  const indentGroup: ToolbarGroup = {
    id: "indent",
    entries: [
      {
        kind: "button",
        icon: IndentDecrease,
        label: "Decrease indent",
        command: outdentSelected,
        active: false,
        shortcut: "⇧ Tab",
      },
      {
        kind: "button",
        icon: IndentIncrease,
        label: "Increase indent",
        command: indentSelected,
        active: false,
        shortcut: "Tab",
      },
    ],
  };

  // Group 6 — Link + Quote. Quote travels with Link because both are
  // inline-or-block annotations the user typically applies to existing
  // content (rather than fresh structural inserts).
  const linkQuote: ToolbarGroup = { id: "link-quote", entries: [] };
  if (editorTools.links) {
    linkQuote.entries.push({
      kind: "slot",
      key: "link",
      node: <LinkControl size="icon" />,
    });
  }
  linkQuote.entries.push({
    kind: "button",
    icon: Quote,
    label: "Quote",
    command: toggleBlockquote,
    active: isAncestorActive(activeState, nodes.blockquote),
    markdown: "> ",
  });
  // Callout + Table tag along after Quote — they're the other two "annotate
  // a stretch of content" inserts that the user keeps near at hand. Each
  // remains gated on its opt-in tool, same as before.
  if (editorTools.callouts) {
    linkQuote.entries.push({
      kind: "slot",
      key: "callout-menu",
      node: <CalloutMenu />,
    });
  }
  if (editorTools.tables) {
    linkQuote.entries.push({
      kind: "button",
      icon: TableIcon,
      label: "Table",
      command: insertTable,
      active: false,
    });
  }

  // Group 7 — doc-specific actions (Note, Scripture). Hidden in dialog scope.
  const docSpecific: ToolbarGroup = { id: "doc-specific", entries: [] };
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
        node: <ScriptureControl />,
      },
    );
  }

  // Group 8 — media inserts. Image + Media are not yet wired into the editor;
  // they're shown as `comingSoon` slots so the toolbar has a permanent home
  // for them — when the feature ships, swap in a real command. Callout + Table
  // moved up into the link-quote group at the user's request.
  const inserts: ToolbarGroup = { id: "inserts", entries: [] };
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

  return [
    history,
    marksGroup,
    headings,
    lists,
    indentGroup,
    linkQuote,
    docSpecific,
    inserts,
  ];
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
 * Single-click callout insert. Drops the variant-picker dropdown: the variant
 * is just a color now, and that color is re-picked inline via the floating
 * chip on the callout itself (CalloutView). The toolbar button always inserts
 * the default `note` variant; the user recolors after the fact.
 */
function CalloutMenu() {
  const ctx = useEditorContext();
  return (
    <SlotTooltip label="Insert callout">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Insert callout"
        // Keep editor focused/selection intact when clicking.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          ctx?.runCommand(insertCallout("note"));
        }}
      >
        <Megaphone className="size-4" />
      </Button>
    </SlotTooltip>
  );
}
