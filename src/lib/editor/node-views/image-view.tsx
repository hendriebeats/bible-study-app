import { NodeSelection, type EditorState } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";

/**
 * Rendered shape of an `image` node — see the schema spec.
 *
 *   • `src`         — bucket public URL (or pending placeholder during upload)
 *   • `naturalW/H`  — used to compute the rendered aspect-ratio (CSS `aspect-ratio`)
 *   • `width`       — percent of the container (25 / 50 / 75 / 100); resize-handle drag
 *   • `align`       — "left" | "center" | "full" (Full = ignore width, span gutter)
 *   • `crop`        — { x, y, w, h } in percent of the underlying image; null = uncropped
 *   • `rotation`    — 0 | 90 | 180 | 270; non-destructive
 *   • `flipH/flipV` — booleans; non-destructive
 *   • `status`      — "uploading" | "ready" | "broken"
 *
 * Cropping is non-destructive: a fixed-size overflow:hidden container holds an
 * <img> positioned with CSS transforms so that the crop rectangle maps to the
 * container's box. Reset is just clearing crop+rotation+flip attrs (free via
 * normal PM undo).
 *
 * Double-click on the image dispatches an `image:open-crop` CustomEvent that a
 * React-side overlay (mounted in the editor chrome) listens for. Replace,
 * Download, Delete are wired directly here.
 */

interface ImageAttrs {
  src: string;
  naturalW: number;
  naturalH: number;
  /** Legacy percent (15–100). 0 falls back to natural-fit when widthPx is
   *  also 0. Existing docs may have this set; new docs use widthPx. */
  width: number;
  /** Fixed pixel width. >0 wins over `width`; capped to 100% of parent. */
  widthPx: number;
  /** Pixels. 0 means "derive from aspect ratio". */
  height: number;
  align: "left" | "center" | "full";
  crop: { x: number; y: number; w: number; h: number } | null;
  /** Any number of degrees. The selection rotate-handle snaps to the nearest
   *  90° on release (Shift held bypasses the snap), so most values in
   *  practice are 0/90/180/270 — but the schema accepts arbitrary angles
   *  so power-users can hold Shift for a tilted layout. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  status: "uploading" | "ready" | "broken";
}

const MIN_W_PX = 50;
const MIN_H_PX = 40;

/** Every resize handle the NodeView renders. Sides (n/s/e/w) stretch one
 *  axis (breaking the aspect); corners (nw/ne/sw/se) scale both axes
 *  uniformly so the aspect is preserved. */
type HandleKind = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const HANDLE_KINDS: readonly HandleKind[] = [
  "n",
  "s",
  "e",
  "w",
  "nw",
  "ne",
  "sw",
  "se",
];

function isCornerHandle(k: HandleKind): boolean {
  return k.length === 2;
}

function readAttrs(node: PMNode): ImageAttrs {
  const a = node.attrs as Partial<ImageAttrs>;
  return {
    src: typeof a.src === "string" ? a.src : "",
    naturalW: typeof a.naturalW === "number" ? a.naturalW : 0,
    naturalH: typeof a.naturalH === "number" ? a.naturalH : 0,
    width: typeof a.width === "number" ? a.width : 100,
    widthPx: typeof a.widthPx === "number" ? a.widthPx : 0,
    height: typeof a.height === "number" ? a.height : 0,
    align: a.align === "left" || a.align === "full" ? a.align : "center",
    crop: a.crop && typeof a.crop === "object" ? a.crop : null,
    rotation:
      typeof a.rotation === "number" && Number.isFinite(a.rotation)
        ? a.rotation
        : 0,
    flipH: a.flipH === true,
    flipV: a.flipV === true,
    status:
      a.status === "uploading" || a.status === "broken" ? a.status : "ready",
  };
}

/** Apply the CSS transforms needed to render `attrs.crop` + rotation + flips
 *  with the image positioned correctly inside an overflow:hidden frame whose
 *  outer aspect-ratio matches the visible crop rect. */
function paintTransforms(
  frame: HTMLElement,
  img: HTMLImageElement,
  attrs: ImageAttrs,
): void {
  // Frame aspect ratio = visible crop rect, accounting for 90/270 rotation
  // swapping the bounding box.
  const crop = attrs.crop ?? { x: 0, y: 0, w: 100, h: 100 };
  const cropAspect =
    (attrs.naturalW * (crop.w / 100)) /
    Math.max(1, attrs.naturalH * (crop.h / 100));
  // 90/270 (mod 180) swap the bounding box. Tilted angles between snap
  // points are clamped to the dominant orientation: ≤45° from a snap means
  // the snap's aspect rules apply.
  const normalized = ((attrs.rotation % 360) + 360) % 360;
  const rotated =
    (normalized > 45 && normalized < 135) ||
    (normalized > 225 && normalized < 315);
  const outerAspect = rotated ? 1 / cropAspect : cropAspect;
  frame.style.aspectRatio = String(outerAspect);

  // Image scales so the crop rect fills the frame; offset so (crop.x, crop.y)
  // sits at (0,0). Then rotate around the frame's center, then flip.
  const scaleX = 100 / Math.max(1, crop.w);
  const scaleY = 100 / Math.max(1, crop.h);
  const tx = -crop.x * scaleX;
  const ty = -crop.y * scaleY;
  const sx = attrs.flipH ? -1 : 1;
  const sy = attrs.flipV ? -1 : 1;

  img.style.width = `${String(scaleX * 100)}%`;
  img.style.height = `${String(scaleY * 100)}%`;
  img.style.left = `${String(tx)}%`;
  img.style.top = `${String(ty)}%`;
  img.style.transformOrigin = "center center";
  img.style.transform = `translate(0,0) rotate(${String(attrs.rotation)}deg) scale(${String(sx)}, ${String(sy)})`;
}

export class ImageView implements NodeView {
  public readonly dom: HTMLElement;
  private readonly frame: HTMLElement;
  private readonly img: HTMLImageElement;
  private readonly handles: Record<HandleKind, HTMLElement>;
  /** Circle-on-a-stem rotation grip above the image (Google Docs style).
   *  Drag to rotate; on release we snap to the nearest 90° unless Shift was
   *  held during the drag. */
  private readonly rotateHandle: HTMLElement;
  private node: PMNode;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly editable: boolean;

  constructor(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    editable: boolean,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.editable = editable;

    const attrs = readAttrs(node);

    // <figure data-image data-align=...> — the outer wrapper.
    // Deliberately NO `.pm-block-host`: that class marks containers that hold
    // draggable children. The image is itself a draggable row whose drag
    // handle comes from the parent (which IS a host).
    this.dom = document.createElement("figure");
    this.dom.setAttribute("data-image", "");
    this.dom.dataset.align = attrs.align;
    this.dom.dataset.status = attrs.status;
    this.dom.contentEditable = "false";

    // Frame: overflow:hidden box whose aspect-ratio == crop rect's. The
    // <img> is positioned absolutely inside so we can pan/scale/rotate it
    // via CSS transforms without re-encoding pixels. The selection
    // toolbar lives OUTSIDE this DOM tree — it's a React-rendered Radix
    // popover anchored to the frame via `image:select` events (see
    // ImageSelectionToolbar in image-editor-integration.tsx).
    this.frame = document.createElement("div");
    this.frame.className = "pm-image-frame";
    this.frame.style.position = "relative";
    this.frame.style.overflow = "hidden";

    this.img = document.createElement("img");
    this.img.className = "pm-image-img";
    this.img.draggable = false;
    this.img.style.position = "absolute";
    this.img.style.userSelect = "none";
    this.img.alt = "";

    this.frame.appendChild(this.img);
    this.dom.appendChild(this.frame);

    // Resize handles — 4 sides + 4 corners. Sides stretch (one axis only),
    // corners preserve aspect ratio. All 8 are rendered; visibility is
    // toggled on selection via the `hidden` attr.
    this.handles = {
      n: this.createHandle("n"),
      s: this.createHandle("s"),
      e: this.createHandle("e"),
      w: this.createHandle("w"),
      nw: this.createHandle("nw"),
      ne: this.createHandle("ne"),
      sw: this.createHandle("sw"),
      se: this.createHandle("se"),
    };
    for (const kind of HANDLE_KINDS) {
      this.frame.appendChild(this.handles[kind]);
    }

    // Rotation handle — circle-on-a-stem above the image, matches Google
    // Docs. The stem is a CSS pseudo-element on the same node; the knob is
    // the node itself.
    this.rotateHandle = document.createElement("div");
    this.rotateHandle.className = "pm-image-rotate-handle";
    this.rotateHandle.dataset.handle = "rotate";
    this.rotateHandle.contentEditable = "false";
    this.rotateHandle.hidden = true;
    this.frame.appendChild(this.rotateHandle);

    this.applyAttrs(attrs);
    this.bindInteractions();
  }

  private createHandle(kind: HandleKind): HTMLElement {
    const h = document.createElement("div");
    h.className = `pm-image-handle pm-image-handle-${kind}`;
    h.dataset.handle = kind;
    h.contentEditable = "false";
    h.hidden = true;
    return h;
  }

  private applyAttrs(attrs: ImageAttrs): void {
    this.dom.dataset.align = attrs.align;
    this.dom.dataset.status = attrs.status;

    // Width modes (checked top-to-bottom):
    //   • align="full"  → 100% of container (explicit override).
    //   • widthPx > 0   → fixed pixel width, capped to parent (max-width
    //                     100%). The current default for any image the
    //                     user has resized or cropped — keeps rendered
    //                     size stable as the window resizes.
    //   • width === 0   → natural-fit (intrinsic px, capped by CSS).
    //   • width 15–100  → legacy percent (existing docs only; new writes
    //                     never produce this).
    if (attrs.align === "full") {
      delete this.frame.dataset.naturalFit;
      this.frame.style.width = "100%";
      this.frame.style.maxWidth = "";
    } else if (attrs.widthPx > 0) {
      delete this.frame.dataset.naturalFit;
      this.frame.style.width = `${String(attrs.widthPx)}px`;
      this.frame.style.maxWidth = "100%";
    } else if (attrs.width === 0) {
      this.frame.dataset.naturalFit = "true";
      this.frame.style.width = "";
      this.frame.style.maxWidth = "";
      if (attrs.naturalW) {
        this.frame.style.setProperty(
          "--pm-image-natural-w",
          `${String(attrs.naturalW)}px`,
        );
      }
    } else {
      delete this.frame.dataset.naturalFit;
      this.frame.style.width = `${String(Math.max(15, Math.min(100, attrs.width)))}%`;
      this.frame.style.maxWidth = "";
    }

    // Explicit-height mode: a positive `height` attr forces a pixel height
    // on the frame and clears the aspect-ratio rule that paintTransforms
    // would otherwise install. This is what lets the side handles stretch
    // the image off-aspect. Height === 0 keeps today's aspect-driven
    // behaviour (corners-only or untouched images).
    const explicitHeight = attrs.height > 0 && attrs.align !== "full";

    // Source. Empty src + "uploading" status renders the spinner placeholder
    // via CSS. "broken" renders the not-available placeholder.
    if (attrs.status === "ready" && attrs.src) {
      if (this.img.getAttribute("src") !== attrs.src) {
        this.img.src = attrs.src;
        // Best-effort dimension backfill if the schema didn't carry it.
        if (!attrs.naturalW || !attrs.naturalH) {
          this.img.addEventListener(
            "load",
            () => {
              this.dispatchAttrUpdate({
                naturalW: this.img.naturalWidth,
                naturalH: this.img.naturalHeight,
              });
            },
            { once: true },
          );
        }
      }
      paintTransforms(this.frame, this.img, attrs);
      if (explicitHeight) {
        // Override the aspect-ratio paintTransforms just set; the user has
        // explicitly chosen a height by dragging a side handle.
        this.frame.style.aspectRatio = "auto";
        this.frame.style.height = `${String(attrs.height)}px`;
      } else {
        this.frame.style.height = "";
      }
    } else {
      this.img.removeAttribute("src");
      this.frame.style.aspectRatio = "16 / 9";
      this.frame.style.height = "";
    }
  }

  private bindInteractions(): void {
    if (!this.editable) return;

    // Double-click → open crop overlay. Listened by a React-mounted overlay
    // higher in the tree (see image-crop-overlay.tsx).
    this.frame.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = this.getPos();
      if (pos === undefined) return;
      this.dom.dispatchEvent(
        new CustomEvent("image:open-crop", {
          bubbles: true,
          detail: { pos, view: this.view, element: this.frame },
        }),
      );
    });

    // Resize handles. Drag the grip → update width and/or height attrs
    // on pointerup. Side handles stretch (one axis); corner handles scale
    // both proportionally so the aspect is preserved.
    for (const kind of HANDLE_KINDS) {
      this.handles[kind].addEventListener("pointerdown", (e) => {
        this.startResize(kind, e);
      });
    }

    // Rotation handle drag — free angle, snapped to nearest 90° on release
    // (Shift held during the drag bypasses the snap and stores the raw angle).
    this.rotateHandle.addEventListener("pointerdown", (e) => {
      this.startRotate(e);
    });
  }

  private startRotate(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const frameRect = this.frame.getBoundingClientRect();
    const cx = frameRect.left + frameRect.width / 2;
    const cy = frameRect.top + frameRect.height / 2;
    const startRot = readAttrs(this.node).rotation;
    // Initial angle from frame-center to the pointer; we'll rotate by the
    // delta from that anchor so the grip stays under the pointer the whole
    // way around.
    const startPointerAngle =
      (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
    let pendingRotation = startRot;
    let shiftHeld = e.shiftKey;
    const target = e.target as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      shiftHeld = ev.shiftKey;
      const angle =
        (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI;
      pendingRotation = startRot + (angle - startPointerAngle);
      // Live preview via direct DOM (avoids a PM tx per pointermove).
      this.img.style.transform = `translate(0,0) rotate(${String(
        pendingRotation,
      )}deg) scale(${readAttrs(this.node).flipH ? "-1" : "1"}, ${
        readAttrs(this.node).flipV ? "-1" : "1"
      })`;
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      // Snap to nearest 90° unless Shift was held at any point during the
      // drag (lets power users tilt freely).
      const final = shiftHeld
        ? pendingRotation
        : Math.round(pendingRotation / 90) * 90;
      this.dispatchAttrUpdate({ rotation: ((final % 360) + 360) % 360 });
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  private startResize(kind: HandleKind, e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const frameRect = this.frame.parentElement?.getBoundingClientRect();
    const containerWidth = frameRect ? frameRect.width : this.frame.clientWidth;
    if (!containerWidth) return;

    // Read current rendered pixel sizes — what the user actually sees right
    // now. Both natural-fit and explicit-percent cases collapse into one
    // pixel-driven starting point, which we then translate into percent
    // (for width) and pixels (for height) at commit time.
    const startW_px = this.frame.clientWidth;
    const startH_px = this.frame.clientHeight;

    // Drop natural-fit mode for the duration of the drag preview so inline
    // styles below aren't fighting the CSS rule that forces width:auto.
    // The commit on pointerup persists this via the attr update.
    delete this.frame.dataset.naturalFit;

    const corner = isCornerHandle(kind);
    const horizDir = kind.includes("e") ? 1 : kind.includes("w") ? -1 : 0;
    const vertDir = kind.includes("s") ? 1 : kind.includes("n") ? -1 : 0;

    const target = e.target as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) * horizDir;
      const dy = (ev.clientY - startY) * vertDir;

      let newW_px = startW_px;
      let newH_px = startH_px;

      if (corner) {
        // Preserve aspect ratio: use whichever axis was dragged further (in
        // proportion to its starting size) as the dominant driver, then
        // derive the other axis from the starting aspect.
        const fracX = startW_px > 0 ? dx / startW_px : 0;
        const fracY = startH_px > 0 ? dy / startH_px : 0;
        const frac = Math.abs(fracX) > Math.abs(fracY) ? fracX : fracY;
        const scale = 1 + frac;
        newW_px = Math.max(MIN_W_PX, startW_px * scale);
        newH_px = Math.max(MIN_H_PX, startH_px * scale);
      } else if (horizDir !== 0) {
        // E or W side → width only, height stays. Image stretches horizontally.
        newW_px = Math.max(MIN_W_PX, startW_px + dx);
      } else {
        // N or S side → height only, width stays. Image stretches vertically.
        newH_px = Math.max(MIN_H_PX, startH_px + dy);
      }

      // Clamp width to container (the live cap; persisted state is the raw
      // px, capped at render time by max-width:100%). Continuous — no snap
      // targets (Google Docs–style smooth drag).
      newW_px = Math.min(newW_px, containerWidth);
      const widthPx = Math.round(Math.max(MIN_W_PX, newW_px));

      // Live preview. Corners clear the explicit height so aspect-ratio CSS
      // (re-applied via the attr update on commit) drives it; sides set both
      // width and height inline so the stretch is visible during the drag.
      this.frame.style.width = `${String(widthPx)}px`;
      this.frame.style.maxWidth = "100%";
      if (corner) {
        this.frame.style.height = "";
        this.frame.style.aspectRatio = String(
          startW_px / Math.max(1, startH_px),
        );
        this.pendingHeight = 0;
      } else {
        this.frame.style.height = `${String(newH_px)}px`;
        this.frame.style.aspectRatio = "auto";
        this.pendingHeight = Math.round(newH_px);
      }
      this.pendingWidth = widthPx;
    };

    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      if (this.pendingWidth !== null) {
        // Persist as widthPx (the new pixel mode); clear the legacy `width`
        // percent so the NodeView's widthPx branch wins on render.
        const patch: Partial<ImageAttrs> = {
          widthPx: this.pendingWidth,
          width: 0,
        };
        if (this.pendingHeight !== null) patch.height = this.pendingHeight;
        this.dispatchAttrUpdate(patch);
        this.pendingWidth = null;
        this.pendingHeight = null;
      }
    };

    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  private pendingWidth: number | null = null;
  private pendingHeight: number | null = null;

  /** Patch one or more attrs on this image node via a PM transaction. All
   *  user-driven mutations (align, width, crop, rotation, flip, status,
   *  natural dims) go through here. */
  private dispatchAttrUpdate(patch: Partial<ImageAttrs>): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      ...patch,
    });
    this.view.dispatch(tr);
  }

  /** Reflect selection state via [data-selected]; toolbar + handles are
   *  CSS-driven off that. */
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.applyAttrs(readAttrs(node));
    return true;
  }

  /** Selection notification from PM. Shows the resize handles and tells the
   *  React side (ImageSelectionToolbar) which figure to anchor its popover
   *  to via an `image:select` CustomEvent. The React component holds a ref
   *  to the figure element and re-reads its bounding rect through a
   *  ResizeObserver, so the popover follows when the user resizes/aligns
   *  without us having to re-fire on every attr change. */
  selectNode(): void {
    this.dom.dataset.selected = "true";
    for (const kind of HANDLE_KINDS) this.handles[kind].hidden = false;
    this.rotateHandle.hidden = false;
    const pos = this.getPos();
    if (pos !== undefined) {
      this.dom.dispatchEvent(
        new CustomEvent("image:select", {
          bubbles: true,
          detail: { view: this.view, pos, element: this.frame },
        }),
      );
    }
  }

  deselectNode(): void {
    delete this.dom.dataset.selected;
    for (const kind of HANDLE_KINDS) this.handles[kind].hidden = true;
    this.rotateHandle.hidden = true;
    this.dom.dispatchEvent(
      new CustomEvent("image:deselect", { bubbles: true }),
    );
  }

  ignoreMutation(): boolean {
    // Attribute changes to handles, transforms etc. are imperative — never
    // let PM mistake them for content edits.
    return true;
  }

  stopEvent(event: Event): boolean {
    // Capture handle + rotate-handle pointer events so PM doesn't treat
    // them as a selection change on the parent block. (The selection
    // toolbar lives outside the NodeView's DOM tree now, so it doesn't
    // need a closest() check here.)
    const target = event.target as Element | null;
    if (
      target?.closest(".pm-image-handle") ||
      target?.closest(".pm-image-rotate-handle")
    ) {
      return true;
    }
    return false;
  }
}

/** Helper for callers that want to know if a state currently selects an
 *  image node (used by the React-side replace/crop overlays). */
export function isImageSelected(state: EditorState): boolean {
  const sel = state.selection;
  return sel instanceof NodeSelection && sel.node.type.name === "image";
}
