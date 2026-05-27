"use client";

import { Keyboard } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** A keyboard shortcut (or markdown shortcut) and what it does. */
interface Shortcut {
  keys: string;
  label: string;
}

/** Modifier glyphs differ by platform: ⌘/⌫ on macOS, Ctrl/Backspace elsewhere. */
interface Mods {
  mod: string;
  del: string;
}

function formatting({ mod }: Mods): Shortcut[] {
  return [
    { keys: `${mod} B`, label: "Bold" },
    { keys: `${mod} I`, label: "Italic" },
    { keys: `${mod} U`, label: "Underline" },
    { keys: `${mod} ⇧ S`, label: "Strikethrough" },
    { keys: `${mod} Z`, label: "Undo" },
    { keys: `${mod} ⇧ Z`, label: "Redo" },
  ];
}

function editing({ mod, del }: Mods): Shortcut[] {
  return [
    { keys: "⇧ Enter", label: "Line break" },
    {
      keys: "Tab / ⇧ Tab",
      label: "Indent / outdent block (or nest list item)",
    },
    {
      keys: `${mod} ⇧ ${del}`,
      label: "Delete selection (incl. verse markers)",
    },
  ];
}

const MARKDOWN: Shortcut[] = [
  { keys: "# / ## / ###", label: "Heading 1 / 2 / 3" },
  { keys: "- or *", label: "Bullet list" },
  { keys: "1.", label: "Numbered list" },
  { keys: ">", label: "Quote" },
  { keys: "```", label: "Code block" },
  { keys: "https://…", label: "Auto-link a URL" },
];

function ShortcutGroup({ title, items }: { title: string; items: Shortcut[] }) {
  return (
    <div className="grid gap-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <dl className="grid gap-1">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-4 text-sm"
          >
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd>
              <kbd className="rounded-sm border bg-muted px-1.5 py-0.5 font-mono text-xs">
                {item.keys}
              </kbd>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Platform never changes at runtime, so there's nothing to subscribe to.
const noopSubscribe = () => () => undefined;

/** Toolbar button opening a dialog listing the editor's keyboard + markdown shortcuts. */
export function ShortcutCheatsheet() {
  // Read the platform without a hydration mismatch: the server snapshot is
  // `false` (Ctrl labels), the client computes from the user agent on mount.
  const isMac = useSyncExternalStore(
    noopSubscribe,
    () => /mac|iphone|ipad|ipod/i.test(navigator.userAgent),
    () => false,
  );

  const mods: Mods = isMac
    ? { mod: "⌘", del: "⌫" }
    : { mod: "Ctrl", del: "Backspace" };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Keyboard shortcuts"
        >
          <Keyboard className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Formatting, editing, and markdown shortcuts available in the editor.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <ShortcutGroup title="Formatting" items={formatting(mods)} />
          <ShortcutGroup title="Editing" items={editing(mods)} />
          <ShortcutGroup title="Markdown" items={MARKDOWN} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
