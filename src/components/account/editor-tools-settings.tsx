"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { saveEditorTools } from "@/app/account/actions";
import {
  EDITOR_TOOL_GROUP_LABELS,
  EDITOR_TOOL_GROUP_ORDER,
  EDITOR_TOOL_REGISTRY,
  type EditorToolGroup,
  type EditorToolKey,
  type EditorToolMeta,
  type EditorTools,
} from "@/lib/editor/editor-tools";
import { cn } from "@/lib/utils";

/**
 * Toggles for the per-user opt-in editor tools (Account → Preferences →
 * Editor tools). Tools are visually grouped by their `group` (Text formatting
 * / Insertable blocks / Media & smart features) so the list is easier to
 * scan, and the entire row is a clickable target — clicking the title,
 * description, or switch all toggle the tool. Each change optimistically
 * updates and persists via `saveEditorTools`, reverting on failure. Tools not
 * yet wired into the editor show a "Coming soon" hint but still persist the
 * preference so it's honored once they ship.
 */
export function EditorToolsSettings({ initial }: { initial: EditorTools }) {
  const [tools, setTools] = useState(initial);
  const [pending, setPending] = useState<EditorToolKey | null>(null);

  // Bucket the flat registry into the groups its `group` field designates,
  // preserving registry order within each bucket. Memoized because the
  // registry is static — same shape every render.
  const grouped = useMemo(() => {
    const buckets: Record<EditorToolGroup, EditorToolMeta[]> = {
      formatting: [],
      blocks: [],
      "media-smart": [],
    };
    for (const tool of EDITOR_TOOL_REGISTRY) {
      buckets[tool.group].push(tool);
    }
    return buckets;
  }, []);

  async function toggle(key: EditorToolKey) {
    if (pending) return;
    const previous = tools;
    const next = { ...tools, [key]: !tools[key] };
    setTools(next);
    setPending(key);
    const result = await saveEditorTools(next);
    setPending(null);
    if (!result.ok) {
      setTools(previous);
      toast.error(result.error || "Couldn't save your editor tools.");
    }
  }

  return (
    <div className="grid gap-6">
      {EDITOR_TOOL_GROUP_ORDER.map((group) => {
        const items = grouped[group];
        if (items.length === 0) return null;
        return (
          <div key={group} className="grid gap-1">
            <h3 className="px-1 text-caption font-semibold tracking-wide text-muted-foreground uppercase">
              {EDITOR_TOOL_GROUP_LABELS[group]}
            </h3>
            <ul className="grid gap-0.5">
              {items.map((tool) => (
                <li key={tool.key}>
                  <EditorToolRow
                    tool={tool}
                    on={tools[tool.key]}
                    disabled={pending !== null && pending !== tool.key}
                    onToggle={() => {
                      void toggle(tool.key);
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A single tool row, rendered as a full-width button so any click anywhere on
 * the row toggles the tool. The nested switch glyph is `aria-hidden` because
 * the outer button already carries `role="switch"` + `aria-checked` — the
 * switch is purely visual.
 */
function EditorToolRow({
  tool,
  on,
  disabled,
  onToggle,
}: {
  tool: EditorToolMeta;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={tool.label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex w-full items-start justify-between gap-4 rounded-md px-3 py-2.5 text-left transition-colors outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
      )}
    >
      <div className="grid min-w-0 gap-1">
        <div className="flex items-center gap-2">
          <span className="text-ui font-medium">{tool.label}</span>
          {!tool.available ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
              Coming soon
            </span>
          ) : null}
        </div>
        <span className="text-ui text-muted-foreground">
          {tool.description}
        </span>
        {tool.shortcut || tool.markdownSyntax ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
            {tool.shortcut ? (
              <span className="inline-flex items-center gap-1.5">
                Shortcut
                <kbd className="inline-flex items-center rounded-sm border border-border/60 bg-background px-1.5 py-0.5 font-mono text-caption text-foreground shadow-sm">
                  {tool.shortcut}
                </kbd>
              </span>
            ) : null}
            {tool.markdownSyntax ? (
              <span className="inline-flex items-center gap-1.5">
                Type
                <code className="inline-flex items-center rounded-sm border border-border/60 bg-background px-1.5 py-0.5 font-mono text-caption text-foreground shadow-sm">
                  {tool.markdownSyntax}
                </code>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <span
        aria-hidden
        className={cn(
          "mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          on ? "bg-primary" : "bg-input",
        )}
      >
        <span
          className={cn(
            "block size-4 rounded-full bg-background shadow-sm transition-transform",
            on ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
