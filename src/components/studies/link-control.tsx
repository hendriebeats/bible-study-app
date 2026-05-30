"use client";

import { ExternalLink, Link2, Unlink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  type LinkPopoverRequest,
  useEditorContext,
} from "@/components/studies/editor-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  activeLinkRange,
  applyLink,
  clearLink,
  normalizeUrl,
} from "@/lib/editor/commands";
import { placeNearAnchor } from "@/lib/editor/floating-position";
import {
  LINK_POPOVER_OPEN_EVENT,
  type LinkPopoverOpenDetail,
} from "@/lib/editor/plugins/link-click";

const POPOVER_WIDTH = 320;
const POPOVER_ESTIMATED_HEIGHT = 168;

/**
 * Toolbar button that opens the shared {@link LinkPopover} for the active
 * editor. The actual popover (URL + display-text fields, Apply / Remove /
 * Open) lives once per editor surface — mounted alongside SelectionBubble —
 * so Mod-K, click-on-link, and this button all converge on one UI.
 *
 * Disabled when there's no editor focused; active styling when the
 * selection or cursor sits on an existing link.
 */
export function LinkControl({ size = "icon" }: { size?: "icon" | "icon-sm" }) {
  const ctx = useEditorContext();
  const buttonRef = useRef<HTMLButtonElement>(null);

  if (!ctx) {
    return null;
  }

  const { activeState, activeView, requestLinkPopoverFor, linkPopover } = ctx;
  const active = activeState ? activeLinkRange(activeState) : null;
  const open = linkPopover !== null;

  const onClick = () => {
    if (!activeView) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    requestLinkPopoverFor(activeView, {
      anchor: rect
        ? {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          }
        : null,
    });
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={buttonRef}
          type="button"
          size={size}
          variant={active ? "secondary" : "ghost"}
          aria-label={active ? "Edit link" : "Add link"}
          aria-pressed={Boolean(active)}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={!activeState}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={onClick}
        >
          <Link2 className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{active ? "Edit link" : "Add link"} (⌘K)</TooltipContent>
    </Tooltip>
  );
}

/**
 * The single, shared link popover. Renders when {@link useEditorContext}'s
 * `linkPopover` is set; closes itself on Escape, outside-click, Apply, or
 * Remove. Owns its own anchor → screen-position math via
 * {@link placeNearAnchor} so it survives the URL field stealing focus from
 * the editor.
 *
 * Also acts as the bridge for the {@link LINK_POPOVER_OPEN_EVENT} window
 * event the link-click plugin and the Mod-K keymap dispatch — translating
 * those into `requestLinkPopoverFor` calls.
 *
 * Mount once per editor surface (StudyWorkspace + any dialog editor).
 *
 * Internal split: the outer component owns the bridge + currently-open
 * request; the inner `LinkPopoverForm` is keyed by `popover.id` so each
 * open re-mounts it (initial field values come from `useState` initializers
 * — no setState-in-effect dance).
 */
export function LinkPopover() {
  const ctx = useEditorContext();
  const requestLinkPopoverFor = ctx?.requestLinkPopoverFor;
  const popover = ctx?.linkPopover ?? null;

  // Bridge: window event → context call. We listen here (rather than in
  // the plugins themselves) so we don't need a separate component for the
  // subscription.
  useEffect(() => {
    if (!requestLinkPopoverFor) return;
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<LinkPopoverOpenDetail>).detail;
      requestLinkPopoverFor(detail.view, { anchor: detail.anchor ?? null });
    };
    window.addEventListener(LINK_POPOVER_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(LINK_POPOVER_OPEN_EVENT, onOpen);
    };
  }, [requestLinkPopoverFor]);

  if (!popover) return null;
  return <LinkPopoverForm key={popover.id} request={popover} />;
}

function LinkPopoverForm({ request }: { request: LinkPopoverRequest }) {
  const ctx = useEditorContext();
  const closeLinkPopover = ctx?.closeLinkPopover;

  const rootRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  // Initial values come from props (cheap useState initializer) — no
  // setState-in-effect required because the outer parent re-mounts us
  // via `key={request.id}` whenever a new popover opens.
  const [url, setUrl] = useState(request.initialUrl);
  const [text, setText] = useState(request.initialText);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: 0,
    top: 0,
  });

  const isEdit = request.mode === "edit";

  // Focus the most-useful field on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (isEdit) {
        textInputRef.current?.focus();
        textInputRef.current?.select();
      } else {
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
      }
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [isEdit]);

  // Position next to the captured anchor.
  useEffect(() => {
    const size = {
      width: POPOVER_WIDTH,
      height: rootRef.current?.offsetHeight ?? POPOVER_ESTIMATED_HEIGHT,
    };
    const placement = placeNearAnchor(request.anchor, size, {
      preferred: "below",
      gap: 8,
      align: "start",
    });
    setPos({ left: placement.left, top: placement.top });
  }, [request.anchor]);

  // Outside-click / Escape close.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        rootRef.current &&
        target instanceof Node &&
        !rootRef.current.contains(target)
      ) {
        closeLinkPopover?.();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeLinkPopover?.();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [closeLinkPopover]);

  const apply = () => {
    const href = normalizeUrl(url);
    if (!href) return;
    const { view, range } = request;
    const displayText = text.trim() === "" ? undefined : text;
    applyLink(
      range.from,
      range.to,
      { href },
      displayText,
    )(view.state, view.dispatch, view);
    view.focus();
    closeLinkPopover?.();
  };

  const remove = () => {
    const { view, range } = request;
    clearLink(range.from, range.to)(view.state, view.dispatch, view);
    view.focus();
    closeLinkPopover?.();
  };

  const openInNewTab = () => {
    const href = normalizeUrl(url);
    if (!href) return;
    window.open(href, "_blank", "noopener,noreferrer");
  };

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label={isEdit ? "Edit link" : "Add link"}
      className="fixed z-50 w-link-popover rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-caption font-medium text-muted-foreground">
            Display text
          </span>
          <Input
            ref={textInputRef}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
            placeholder="Link text"
            className="h-8"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption font-medium text-muted-foreground">
            URL
          </span>
          <Input
            ref={urlInputRef}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
            placeholder="https://…"
            className="h-8"
          />
        </label>
        <div className="flex items-center gap-1 pt-1">
          <Button
            type="button"
            size="sm"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={apply}
            disabled={normalizeUrl(url) === null}
          >
            {isEdit ? "Update" : "Apply"}
          </Button>
          {isEdit ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={remove}
              className="gap-1 text-destructive hover:text-destructive"
            >
              <Unlink className="size-4" />
              Remove
            </Button>
          ) : null}
          {isEdit && normalizeUrl(url) !== null ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={openInNewTab}
              className="ml-auto gap-1"
            >
              <ExternalLink className="size-4" />
              Open
            </Button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
