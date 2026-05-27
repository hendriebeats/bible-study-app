"use client";

import { ExternalLink, Link2, Unlink } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useEditorContext } from "@/components/studies/editor-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  activeLinkRange,
  applyLink,
  clearLink,
  normalizeUrl,
} from "@/lib/editor/commands";

/**
 * Add / edit / remove a link on the active editor. Mirrors {@link ColorControl}:
 * a self-positioned popover (not Radix) that closes on outside-click / Escape.
 * The target range is captured when the popover OPENS (the URL field then takes
 * focus from the editor), so applying always hits the originally-selected text.
 * Opening over an existing link seeds the field + shows Remove.
 */
export function LinkControl({ size = "icon" }: { size?: "icon" | "icon-sm" }) {
  const ctx = useEditorContext();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [target, setTarget] = useState<{ from: number; to: number } | null>(
    null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        rootRef.current &&
        target instanceof Node &&
        !rootRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!ctx) {
    return null;
  }

  const { activeState, runCommand } = ctx;
  const active = activeState ? activeLinkRange(activeState) : null;

  const openPanel = () => {
    // Capture the range NOW — once the URL field is focused the editor blurs.
    // Prefer the link under the cursor; otherwise the current selection.
    const sel = activeState?.selection;
    setTarget(
      active
        ? { from: active.from, to: active.to }
        : sel
          ? { from: sel.from, to: sel.to }
          : null,
    );
    setValue(active?.href ?? "");
    setOpen(true);
    // Focus the field after it mounts.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const apply = () => {
    const href = normalizeUrl(value);
    if (!href || !target) {
      return;
    }
    runCommand(applyLink(target.from, target.to, href));
    setOpen(false);
  };

  const remove = () => {
    if (target) {
      runCommand(clearLink(target.from, target.to));
    }
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        size={size}
        variant={active ? "secondary" : "ghost"}
        aria-label={active ? "Edit link" : "Add link"}
        aria-pressed={Boolean(active)}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={!activeState}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openPanel();
          }
        }}
      >
        <Link2 className="size-4" />
      </Button>
      {open ? (
        <div
          role="group"
          aria-label="Link"
          className="absolute top-full left-0 z-50 mt-1 flex w-72 flex-col gap-2 rounded-lg border bg-popover p-2 shadow-md ring-1 ring-foreground/10"
        >
          <Input
            ref={inputRef}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
            placeholder="https://…"
            aria-label="Link URL"
            className="h-8"
          />
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={apply}
              disabled={normalizeUrl(value) === null}
            >
              {active ? "Update" : "Apply"}
            </Button>
            {active ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={remove}
                >
                  <Unlink className="size-4" />
                  Remove
                </Button>
                <Button asChild size="sm" variant="ghost" className="ml-auto">
                  <a
                    href={active.href}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <ExternalLink className="size-4" />
                    Visit
                  </a>
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
