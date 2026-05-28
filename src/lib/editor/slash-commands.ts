import { setBlockType } from "prosemirror-commands";
import {
  ChevronRight,
  CircleCheck,
  Heading1,
  Heading2,
  Heading3,
  Heart,
  Info,
  Lightbulb,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Quote,
  Table,
  TriangleAlert,
  Type,
} from "lucide-react";
import type { Command } from "prosemirror-state";

import {
  insertCallout,
  insertCollapsible,
  insertTable,
  toggleBlockquote,
  toggleBulletList,
  toggleHeading,
  toggleOrderedList,
  toggleTaskList,
} from "./commands";
import type { EditorToolKey, EditorTools } from "./editor-tools";
import { nodes } from "./schema";

/**
 * One entry in the slash (`/`) command menu. `command` runs against the active
 * editor (after the `/query` text is removed). `tool` gates the entry behind an
 * opt-in editor tool — undefined means always available. `turnInto` marks an
 * entry as a block-type conversion (so the block handle's "Turn into" menu can
 * reuse this registry, excluding insert-only entries like callouts).
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
}

const setParagraph: Command = setBlockType(nodes.paragraph);

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
  },
  {
    id: "bullet",
    label: "Bullet list",
    keywords: ["unordered", "ul", "bullets"],
    group: "Lists",
    icon: List,
    command: toggleBulletList,
    turnInto: true,
  },
  {
    id: "ordered",
    label: "Numbered list",
    keywords: ["ordered", "ol", "numbers"],
    group: "Lists",
    icon: ListOrdered,
    command: toggleOrderedList,
    turnInto: true,
  },
  {
    id: "checklist",
    label: "Checklist",
    keywords: ["task", "todo", "checkbox", "check"],
    group: "Lists",
    icon: ListChecks,
    command: toggleTaskList,
    turnInto: true,
  },
  {
    id: "quote",
    label: "Quote",
    keywords: ["blockquote", "citation"],
    group: "Basic",
    icon: Quote,
    command: toggleBlockquote,
    turnInto: true,
  },
  // Callouts — opt-in (gate "callouts"); insert-only (not turn-into).
  {
    id: "callout-note",
    label: "Callout: Note",
    keywords: ["callout", "note", "info", "aside"],
    group: "Callouts",
    icon: Info,
    command: insertCallout("note"),
    tool: "callouts",
  },
  {
    id: "callout-insight",
    label: "Callout: Key insight",
    keywords: ["callout", "insight", "key", "idea"],
    group: "Callouts",
    icon: Lightbulb,
    command: insertCallout("insight"),
    tool: "callouts",
  },
  {
    id: "callout-warning",
    label: "Callout: Warning",
    keywords: ["callout", "warning", "caution", "danger"],
    group: "Callouts",
    icon: TriangleAlert,
    command: insertCallout("warning"),
    tool: "callouts",
  },
  {
    id: "callout-prayer",
    label: "Callout: Prayer",
    keywords: ["callout", "prayer", "pray"],
    group: "Callouts",
    icon: Heart,
    command: insertCallout("prayer"),
    tool: "callouts",
  },
  {
    id: "callout-application",
    label: "Callout: Application",
    keywords: ["callout", "application", "apply", "action"],
    group: "Callouts",
    icon: CircleCheck,
    command: insertCallout("application"),
    tool: "callouts",
  },
  {
    id: "collapsible",
    label: "Collapsible section",
    keywords: ["toggle", "collapse", "fold", "details", "accordion"],
    group: "Blocks",
    icon: ChevronRight,
    command: insertCollapsible,
    tool: "collapsibles",
  },
  {
    id: "table",
    label: "Table",
    keywords: ["table", "grid", "rows", "columns", "cells"],
    group: "Blocks",
    icon: Table,
    command: insertTable,
    tool: "tables",
  },
] as const;

/** Does this entry pass the user's opt-in gate? */
function toolEnabled(entry: SlashCommand, tools: EditorTools): boolean {
  return !entry.tool || tools[entry.tool];
}

/** The slash commands matching `query`, with tool-gated entries filtered out. */
export function filterSlashCommands(
  query: string,
  tools: EditorTools,
): SlashCommand[] {
  const q = query.trim().toLowerCase();
  return SLASH_COMMANDS.filter((entry) => {
    if (!toolEnabled(entry, tools)) {
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
