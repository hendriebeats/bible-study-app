"use client";

import {
  AlignCenter,
  AlignLeft,
  Download as DownloadIcon,
  ImageUp,
  Maximize2,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { EditorView } from "prosemirror-view";

import { ImageCropOverlay } from "@/components/studies/image-crop-overlay";
import { ImageInsertDialog } from "@/components/studies/image-insert-dialog";
import { Button } from "@/components/ui/button";
import {
  PopoverContent,
  type VirtualRect,
  VirtualAnchorPopover,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { insertNodeNextToCursor } from "@/lib/editor/commands";
import { nodes } from "@/lib/editor/schema";

/**
 * React-side glue between the editor's CustomEvent surface and the image
 * dialog + crop overlay. Mounted once per document editor; listens for:
 *
 *   • `image:open-insert`  — slash menu / toolbar Image button. Opens the
 *                            insert dialog; on result, inserts a fresh image
 *                            node at the current selection.
 *   • `image:open-replace` — image toolbar Replace action. Opens the same
 *                            dialog in replace mode; on result, swaps `src`
 *                            (and natural dims) on the targeted node.
 *   • `image:open-crop`    — image double-click. Picked up directly by the
 *                            crop overlay (mounted here for proximity).
 *
 * Without this component the editor's slash/toolbar would emit events with
 * nothing listening, and the crop overlay would never get mounted.
 */

interface Props {
  studyId: string;
  userId: string;
}

interface InsertSession {
  view: EditorView;
  mode: "insert" | "replace";
  /** For replace mode: the node position to swap attrs on. */
  pos?: number;
}

export function ImageEditorIntegration({ studyId, userId }: Props) {
  const [session, setSession] = useState<InsertSession | null>(null);

  useEffect(() => {
    const onInsert = (e: Event) => {
      const ce = e as CustomEvent<{ view: EditorView }>;
      setSession({ view: ce.detail.view, mode: "insert" });
    };
    const onReplace = (e: Event) => {
      const ce = e as CustomEvent<{ view: EditorView; pos: number }>;
      setSession({
        view: ce.detail.view,
        mode: "replace",
        pos: ce.detail.pos,
      });
    };
    document.addEventListener("image:open-insert", onInsert);
    document.addEventListener("image:open-replace", onReplace);
    return () => {
      document.removeEventListener("image:open-insert", onInsert);
      document.removeEventListener("image:open-replace", onReplace);
    };
  }, []);

  const handleInsert = useCallback(
    (result: { src: string; naturalW: number; naturalH: number }) => {
      if (!session) return;
      if (session.mode === "replace" && session.pos !== undefined) {
        const node = session.view.state.doc.nodeAt(session.pos);
        if (node?.type.name !== "image") return;
        // Swap src + dimensions; clear crop/rotation/flips AND reset width
        // to the natural-fit sentinel so the new image starts at its own
        // intrinsic size rather than inheriting the previous image's frame.
        const tr = session.view.state.tr.setNodeMarkup(session.pos, undefined, {
          ...node.attrs,
          src: result.src,
          naturalW: result.naturalW,
          naturalH: result.naturalH,
          width: 0,
          crop: null,
          rotation: 0,
          flipH: false,
          flipV: false,
          status: "ready",
        });
        session.view.dispatch(tr);
        return;
      }
      // Insert mode: place the image as a block sibling after the caret's
      // current block (paragraph, verse, etc.) — same placement contract as
      // the slash-menu's callout/collapsible/table inserters. An inline
      // replaceSelectionWith would otherwise split the host textblock.
      const node = nodes.image.create({
        src: result.src,
        naturalW: result.naturalW,
        naturalH: result.naturalH,
        status: "ready",
      });
      const { state } = session.view;
      session.view.dispatch(
        insertNodeNextToCursor(state, node).scrollIntoView(),
      );
    },
    [session],
  );

  return (
    <>
      <ImageInsertDialog
        open={session !== null}
        onOpenChange={(o) => {
          if (!o) setSession(null);
        }}
        studyId={studyId}
        userId={userId}
        mode={session?.mode ?? "insert"}
        onInsert={handleInsert}
      />
      <ImageSelectionToolbar />
      <ImageCropOverlay />
    </>
  );
}

// ---------------------------------------------------------------------------
// Selection toolbar (Align / Replace / Download / Delete) — floats above the
// selected image as a Radix popover. Re-anchors on resize/scroll because
// ResizeObserver pings the rect after every layout change.
// ---------------------------------------------------------------------------

interface SelectionTarget {
  view: EditorView;
  pos: number;
  element: HTMLElement;
}

function ImageSelectionToolbar() {
  const [target, setTarget] = useState<SelectionTarget | null>(null);
  const [rect, setRect] = useState<VirtualRect | null>(null);

  // Subscribe to image:select / image:deselect events at the document level
  // (NodeView fires them as bubbling CustomEvents from inside the editor).
  useEffect(() => {
    const onSelect = (e: Event) => {
      const ce = e as CustomEvent<SelectionTarget>;
      setTarget(ce.detail);
    };
    const onDeselect = () => {
      setTarget(null);
      setRect(null);
    };
    document.addEventListener("image:select", onSelect);
    document.addEventListener("image:deselect", onDeselect);
    return () => {
      document.removeEventListener("image:select", onSelect);
      document.removeEventListener("image:deselect", onDeselect);
    };
  }, []);

  // Track the element's viewport rect. Re-reads on layout changes
  // (ResizeObserver), scrolls anywhere in the page (capture so editor scroll
  // containers are caught too), and window resizes. Snapshots immediately on
  // target change via useLayoutEffect so the popover never flashes at (0, 0).
  const measure = useCallback(() => {
    if (!target) return;
    const r = target.element.getBoundingClientRect();
    setRect({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, [target]);

  useLayoutEffect(() => {
    if (!target) return;
    // ResizeObserver fires its callback once immediately on `observe(...)`
    // in all evergreen browsers — no explicit initial measure() needed,
    // which keeps the effect off the react-hooks/set-state-in-effect lint
    // (and avoids a doubled render on mount).
    const ro = new ResizeObserver(measure);
    ro.observe(target.element);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [measure, target]);

  if (!target || !rect) return null;

  // Action helpers. Each builds + dispatches a PM transaction on the view
  // we got from the NodeView's event detail. The figure's NodeView re-runs
  // applyAttrs after each transaction, ResizeObserver picks up the layout
  // change, and the popover re-positions on its own.
  const node = target.view.state.doc.nodeAt(target.pos);
  const isImage = node?.type.name === "image";

  const patchAttrs = (patch: Record<string, unknown>) => {
    if (!isImage) return;
    target.view.dispatch(
      target.view.state.tr.setNodeMarkup(target.pos, undefined, {
        ...node.attrs,
        ...patch,
      }),
    );
  };

  const deleteImage = () => {
    if (!isImage) return;
    target.view.dispatch(
      target.view.state.tr.delete(target.pos, target.pos + node.nodeSize),
    );
  };

  const downloadImage = () => {
    const src = node?.attrs.src as unknown;
    if (typeof src !== "string" || !src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = src.split("/").pop() ?? "image";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const openReplace = () => {
    target.element.dispatchEvent(
      new CustomEvent("image:open-replace", {
        bubbles: true,
        detail: { view: target.view, pos: target.pos },
      }),
    );
  };

  const align = (node?.attrs.align as string | undefined) ?? "center";

  // Every action calls back into PM and then refocuses the editor so the
  // user's next keypress (notably Cmd-Z to undo a delete) lands on the
  // editor's history, not the page.
  const refocus = () => {
    target.view.focus();
  };

  return (
    <VirtualAnchorPopover
      rect={rect}
      open
      onOpenChange={(next) => {
        // Radix calls this on outside click / Escape. We don't dismiss on
        // outside click here — selection is driven by ProseMirror and
        // clicking elsewhere will fire image:deselect for us. Escape =
        // bring PM focus back so the next undo lands on the editor.
        if (!next) target.view.focus();
      }}
    >
      <PopoverContent
        role="toolbar"
        aria-label="Image actions"
        side="top"
        align="center"
        sideOffset={8}
        // Don't let Radix yank focus into the popover when it opens — PM
        // must keep its NodeSelection so Cmd-Z still undoes within the doc
        // after a toolbar action (notably Delete).
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        // Belt-and-braces: preventDefault on mousedown stops the click from
        // shifting focus before the button's onClick fires.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        className="flex items-center gap-1 p-1"
      >
        <ToolbarButton
          icon={<AlignLeft className="size-4" />}
          label="Align left"
          active={align === "left"}
          onClick={() => {
            patchAttrs({ align: "left" });
            refocus();
          }}
        />
        <ToolbarButton
          icon={<AlignCenter className="size-4" />}
          label="Center"
          active={align === "center"}
          onClick={() => {
            patchAttrs({ align: "center" });
            refocus();
          }}
        />
        <ToolbarButton
          icon={<Maximize2 className="size-4" />}
          label="Full width"
          active={align === "full"}
          onClick={() => {
            patchAttrs({ align: "full" });
            refocus();
          }}
        />
        <Separator orientation="vertical" className="mx-1 h-5 self-center" />
        <ToolbarButton
          icon={<ImageUp className="size-4" />}
          label="Replace"
          onClick={() => {
            openReplace();
            refocus();
          }}
        />
        <ToolbarButton
          icon={<DownloadIcon className="size-4" />}
          label="Download"
          onClick={() => {
            downloadImage();
            refocus();
          }}
        />
        <ToolbarButton
          icon={<Trash2 className="size-4" />}
          label="Delete"
          onClick={() => {
            deleteImage();
            // After delete the figure DOM is gone; refocus the editor so
            // Cmd-Z immediately undoes back to the deleted image. No
            // selection-deselect event was needed — PM cleans up.
            refocus();
          }}
        />
      </PopoverContent>
    </VirtualAnchorPopover>
  );
}

/**
 * Image-toolbar icon button. Wrapped in a Tooltip so hover surfaces the
 * label (matching the rich-text toolbar's `ToolbarIconButton`). `onMouseDown`
 * preventDefault keeps the editor focused — without it the click would
 * shift focus to the button and the next keystroke (notably Cmd-Z) would
 * miss the editor's history.
 */
function ToolbarButton({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? "secondary" : "ghost"}
          size="icon"
          aria-label={label}
          aria-pressed={active}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
