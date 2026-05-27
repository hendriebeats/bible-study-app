"use client";

import { useState } from "react";
import { toast } from "sonner";

import { saveEditorTools } from "@/app/account/actions";
import {
  EDITOR_TOOL_REGISTRY,
  type EditorToolKey,
  type EditorTools,
} from "@/lib/editor/editor-tools";
import { cn } from "@/lib/utils";

/**
 * Toggles for the per-user opt-in editor tools (Account → Editor tools). Each
 * change optimistically updates and persists via `saveEditorTools`, reverting
 * on failure. Tools not yet wired into the editor show a "Coming soon" hint but
 * still persist the preference so it's honored once they ship.
 */
export function EditorToolsSettings({ initial }: { initial: EditorTools }) {
  const [tools, setTools] = useState(initial);
  const [pending, setPending] = useState<EditorToolKey | null>(null);

  async function toggle(key: EditorToolKey) {
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
    <div className="grid gap-5">
      {EDITOR_TOOL_REGISTRY.map((tool) => {
        const on = tools[tool.key];
        return (
          <div
            key={tool.key}
            className="flex items-start justify-between gap-4"
          >
            <div className="grid gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{tool.label}</span>
                {!tool.available ? (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    Coming soon
                  </span>
                ) : null}
              </div>
              <span className="text-sm text-muted-foreground">
                {tool.description}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={tool.label}
              disabled={pending === tool.key}
              onClick={() => {
                void toggle(tool.key);
              }}
              className={cn(
                "mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                on ? "bg-primary" : "bg-input",
              )}
            >
              <span
                className={cn(
                  "block size-4 rounded-full bg-background shadow-sm transition-transform",
                  on ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
          </div>
        );
      })}
    </div>
  );
}
