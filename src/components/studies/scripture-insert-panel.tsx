"use client";

import { useState } from "react";
import { toast } from "sonner";

import { saveScriptureOptions } from "@/app/account/actions";
import { useEditorContext } from "@/components/studies/editor-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_SCRIPTURE_OPTIONS,
  type ScriptureLayout,
  type ScriptureOptions,
} from "@/lib/scripture/options";

/** Boolean-valued keys of ScriptureOptions, for the toggle chips. */
type BoolKey = {
  [K in keyof ScriptureOptions]: ScriptureOptions[K] extends boolean
    ? K
    : never;
}[keyof ScriptureOptions];

const LAYOUTS: { value: ScriptureLayout; label: string }[] = [
  { value: "translator-paragraphs", label: "Paragraphs" },
  { value: "verse-per-line", label: "Verse per line" },
  { value: "single-block", label: "One block" },
];

const TOGGLES: { key: BoolKey; label: string }[] = [
  { key: "preservePoetry", label: "Poetry line breaks" },
  { key: "includeSelahs", label: "Selahs" },
  { key: "smallCaps", label: "Small caps (Lord)" },
];

/**
 * The scripture-insertion panel revealed by the toolbar's "Scripture" button.
 * It seeds the reference from the section title (when that's a valid reference)
 * and the options from the user's saved defaults, lets them override per-insert,
 * and optionally remembers the choices as their new defaults.
 */
export function ScriptureInsertPanel({ onClose }: { onClose: () => void }) {
  const ctx = useEditorContext();
  const [reference, setReference] = useState(() => ctx?.prefillReference ?? "");
  const [options, setOptions] = useState<ScriptureOptions>(
    () => ctx?.scriptureOptions ?? DEFAULT_SCRIPTURE_OPTIONS,
  );
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!ctx) {
    return null;
  }
  const { insertScripture } = ctx;

  function toggle(key: BoolKey) {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function setLayout(value: ScriptureLayout) {
    setOptions((prev) => ({ ...prev, layout: value }));
  }

  async function submit() {
    const trimmed = reference.trim();
    if (trimmed === "") {
      return;
    }
    setBusy(true);
    const result = await insertScripture(trimmed, options);
    if (!result.ok) {
      setBusy(false);
      toast.error(result.error ?? "Couldn't add that passage.");
      return;
    }
    if (remember) {
      const saved = await saveScriptureOptions(options);
      if (!saved.ok) {
        toast.error("Passage added, but couldn't save your defaults.");
      }
    }
    setBusy(false);
    onClose();
  }

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={reference}
          onChange={(event) => {
            setReference(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
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
          disabled={busy || reference.trim() === ""}
          onClick={() => {
            void submit();
          }}
        >
          Add
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Layout
        </span>
        <div className="flex flex-wrap gap-1">
          {LAYOUTS.map((layout) => (
            <Button
              key={layout.value}
              type="button"
              size="sm"
              variant={
                options.layout === layout.value ? "secondary" : "outline"
              }
              aria-pressed={options.layout === layout.value}
              onClick={() => {
                setLayout(layout.value);
              }}
            >
              {layout.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Include
        </span>
        <div className="flex flex-wrap gap-1">
          {TOGGLES.map(({ key, label }) => {
            // Poetry breaks are meaningless for a single continuous block.
            const disabled =
              key === "preservePoetry" && options.layout === "single-block";
            return (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={options[key] ? "secondary" : "outline"}
                aria-pressed={options[key]}
                disabled={disabled}
                onClick={() => {
                  toggle(key);
                }}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>

      <Label className="text-sm font-normal text-muted-foreground">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => {
            setRemember(event.target.checked);
          }}
          className="size-4 accent-primary"
        />
        Remember these settings as my default
      </Label>
    </div>
  );
}
