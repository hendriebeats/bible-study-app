import { setBlockType } from "prosemirror-commands";
import {
  ChevronRight,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Megaphone,
  Quote,
  Table,
  Type,
} from "lucide-react";
import type { Command, EditorState } from "prosemirror-state";

import {
  insertCallout,
  insertCollapsible,
  insertTable,
  isAncestorActive,
  toggleBlockquote,
  toggleBulletList,
  toggleHeading,
  toggleOrderedList,
  toggleTaskList,
} from "./commands";
import type { EditorToolKey, EditorTools } from "./editor-tools";
import { nodes } from "./schema";
import { isChromeChild } from "./wrapper-chrome";

/**
 * One entry in the slash (`/`) command menu. `command` runs against the active
 * editor (after the `/query` text is removed). `tool` gates the entry behind an
 * opt-in editor tool — undefined means always available. `turnInto` marks an
 * entry as a block-type conversion (so the block handle's "Turn into" menu can
 * reuse this registry, excluding insert-only entries like callouts).
 *
 * `hiddenWhen` is an optional cursor-context predicate that hides the entry in
 * the slash menu when it returns true. Used to keep the while-typing surface
 * honest — entries that can't deliver at the current cursor (e.g. anything
 * block-shaped inside a callout/collapsible HEADER, or "Quote" while already
 * inside a quote) stay invisible there. Turn-into and the toolbar bypass this
 * predicate so they remain the explicit conversion escape hatches.
 */
export interface SlashCommand {
  id: string;
  label: string;
  keywords: string[];
  group: string;
  icon: LucideIcon;
  command: Command;
  tool?: EditorToolKey;
  turnInto?: boolean;
  hiddenWhen?: (state: EditorState) => boolean;
}

const setParagraph: Command = setBlockType(nodes.paragraph);

/**
 * True when the cursor sits in the index-0 child of a `callout` or
 * `collapsible` — the chrome "header" zone. Mirrors the same check used by
 * the input-rule gate in `convert-block.ts`, so the slash menu's visible
 * entries match what the keyboard would let the user type.
 */
function inChromeHeader(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if (isChromeChild($from.node(d - 1), $from.index(d - 1))) {
      return true;
    }
  }
  return false;
}

/** True when the cursor is already inside a blockquote — used to hide the
 *  slash menu's "Quote" entry (wrap-blockquote would silently no-op there). */
function inBlockquote(state: EditorState): boolean {
  return isAncestorActive(state, nodes.blockquote);
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: "text",
    label: "Text",
    keywords: ["paragraph", "plain", "body"],
    group: "Basic",
    icon: Type,
    command: setParagraph,
    turnInto: true,
  },
  {
    id: "h1",
    label: "Heading 1",
    keywords: ["title", "h1", "large"],
    group: "Basic",
    icon: Heading1,
    command: toggleHeading(1),
    turnInto: true,
    tool: "headings",
    hiddenWhen: inChromeHeader,
  },
  {
    id: "h2",
    label: "Heading 2",
    keywords: ["subtitle", "h2", "medium"],
    group: "Basic",
    icon: Heading2,
    command: toggleHeading(2),
    turnInto: true,
    tool: "headings",
    hiddenWhen: inChromeHeader,
  },
  {
    id: "h3",
    label: "Heading 3",
    keywords: ["h3", "small heading"],
    group: "Basic",
    icon: Heading3,
    command: toggleHeading(3),
    turnInto: true,
    tool: "headings",
    hiddenWhen: inChromeHeader,
  },
  {
    id: "bullet",
    label: "Bullet list",
    keywords: ["unordered", "ul", "bullets"],
    group: "Lists",
    icon: List,
    command: toggleBulletList,
    turnInto: true,
    hiddenWhen: inChromeHeader,
  },
  {
    id: "ordered",
    label: "Numbered list",
    keywords: ["ordered", "ol", "numbers"],
    group: "Lists",
    icon: ListOrdered,
    command: toggleOrderedList,
    turnInto: true,
    hiddenWhen: inChromeHeader,
  },
  {
    id: "checklist",
    label: "Checklist",
    keywords: ["task", "todo", "checkbox", "check"],
    group: "Lists",
    icon: ListChecks,
    command: toggleTaskList,
    turnInto: true,
    hiddenWhen: inChromeHeader,
  },
  {
    id: "quote",
    label: "Quote",
    keywords: ["blockquote", "citation"],
    group: "Basic",
    icon: Quote,
    command: toggleBlockquote,
    turnInto: true,
    hiddenWhen: (state) => inChromeHeader(state) || inBlockquote(state),
  },
  // Callout — single entry that inserts a default-color callout. The user
  // re-colors after the fact via the inline tone chip on the wrapper (no
  // more variant naming — variants are just colors). Matches the toolbar
  // button which also became a single click in round 6.
  {
    id: "callout",
    label: "Callout",
    keywords: ["callout", "note", "info", "aside", "highlight"],
    group: "Blocks",
    icon: Megaphone,
    command: insertCallout("note"),
    tool: "callouts",
    hiddenWhen: inChromeHeader,
  },
  {
    id: "collapsible",
    label: "Collapsible section",
    keywords: ["toggle", "collapse", "fold", "details", "accordion"],
    group: "Blocks",
    icon: ChevronRight,
    command: insertCollapsible,
    tool: "collapsibles",
    hiddenWhen: inChromeHeader,
  },
  {
    id: "table",
    label: "Table",
    keywords: ["table", "grid", "rows", "columns", "cells"],
    group: "Blocks",
    icon: Table,
    command: insertTable,
    tool: "tables",
    hiddenWhen: inChromeHeader,
  },
] as const;

/** Does this entry pass the user's opt-in gate? */
function toolEnabled(entry: SlashCommand, tools: EditorTools): boolean {
  return !entry.tool || tools[entry.tool];
}

/** The slash commands matching `query`, with tool-gated and
 *  cursor-context-gated entries filtered out. `state` powers the per-entry
 *  `hiddenWhen` predicates (chrome-header lockdown, in-blockquote Quote). */
export function filterSlashCommands(
  query: string,
  tools: EditorTools,
  state: EditorState,
): SlashCommand[] {
  const q = query.trim().toLowerCase();
  return SLASH_COMMANDS.filter((entry) => {
    if (!toolEnabled(entry, tools)) {
      return false;
    }
    if (entry.hiddenWhen?.(state) === true) {
      return false;
    }
    if (q === "") {
      return true;
    }
    return (
      entry.label.toLowerCase().includes(q) ||
      entry.keywords.some((keyword) => keyword.includes(q))
    );
  });
}

/** Block-type conversions for the block handle's "Turn into" menu (tool-gated). */
export function filterTurnInto(tools: EditorTools): SlashCommand[] {
  return SLASH_COMMANDS.filter(
    (entry) => entry.turnInto === true && toolEnabled(entry, tools),
  );
}
