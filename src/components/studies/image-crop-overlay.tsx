"use client";

import {
  FlipHorizontal,
  FlipVertical,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
// Stage geometry is FROZEN at open time. Standard cropper UX (Photoshop,
// react-easy-crop): the crop canvas size is computed once when the user
// enters crop mode, and crop-handle drags operate against that fixed
// canvas. Recomputing the stage as crop% changes (which the previous
// implementation did via `stageWidth = figW * 100/cropW`) makes the crop
// frame's pixel width pegged to the figure's original size — the user
// drags the east handle, the stage shrinks in lockstep, and visually
// nothing changes. Freezing the stage breaks that lock-in.
import { createPortal } from "react-dom";
import type { EditorView } from "prosemirror-view";

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

/**
 * In-place crop + rotate + flip editor. Mounted once per document editor;
 * listens for `image:open-crop` CustomEvents bubbled from {@link ImageView}.
 *
 * No modal. The crop frame renders as an absolute overlay (React portal)
 * positioned over the image's full natural-aspect rect, and a small
 * controls popover (rotate / flip / reset) anchors to it.
 *
 * Crop math is non-destructive: on commit we dispatch one PM transaction
 * that sets `crop / rotation / flipH / flipV` (and a preserve-scale
 * `width`) on the image node. The NodeView re-renders the live image with
 * the new CSS transforms — no derivative file, no canvas.
 *
 * Interaction model (intentionally one-way — there is no Cancel):
 *   • Drag the crop frame's edges or corners. Corners lock to the CURRENT
 *     crop's visible aspect (no preset dropdown — the lock follows whatever
 *     shape the crop is at drag-start). Sides stretch one axis only.
 *   • ESC, Enter, or click anywhere outside the crop frame + controls →
 *     commit the current state and close. There is no "cancel" — Cmd-Z
 *     undoes the commit if the user changes their mind.
 *
 * Crop coords are PERCENTS of the FULL image (not the cropped sub-region),
 * so re-opening the overlay always shows the full image regardless of any
 * prior crop.
 */

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Anchor {
  west: number;
  east: number;
  north: number;
  south: number;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
}

const INITIAL_ANCHOR: Anchor = {
  west: 0,
  east: 0,
  north: 0,
  south: 0,
  cropX: 0,
  cropY: 0,
  cropW: 100,
  cropH: 100,
};

interface Target {
  view: EditorView;
  pos: number;
  element: HTMLElement;
  src: string;
  naturalW: number;
  naturalH: number;
}

const FULL: CropRect = { x: 0, y: 0, w: 100, h: 100 };

export function ImageCropOverlay() {
  const [target, setTarget] = useState<Target | null>(null);
  const [rect, setRect] = useState<VirtualRect | null>(null);
  const [crop, setCrop] = useState<CropRect>(FULL);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  // Snapshot of the crop AT OPEN — used for stage-geometry math so the
  // stage stays rigid as the user drags handles within it. The live
  // `crop` state still updates per-drag (for the crop frame itself).
  // Held in state (not a ref) so it can be read during render without
  // tripping the react-hooks/refs rule; each setter is paired with another
  // state update so the render-batching semantics match the old ref code.
  const [initialCrop, setInitialCrop] = useState<CropRect>(FULL);
  const [initialRotation, setInitialRotation] = useState<number>(0);
  // Which handle is currently being dragged. Determines which corner of
  // the crop frame stays anchored on screen during the drag (the OPPOSITE
  // of the handle being grabbed). Cleared on pointerup.
  const [activeHandle, setActiveHandle] = useState<HandleKind | null>(null);
  // Anchor snapshot — the screen-space positions of the cropFrame's four
  // edges AND the corresponding crop% values, captured at drag start (and
  // updated on drag end so default-anchor at-rest reflects the new state).
  // The stage-geometry math reads these to position + scale the stage so
  // the anchored edge stays glued where the user left it. Same state-not-ref
  // treatment as initialCrop/initialRotation above — each write happens in
  // an event handler that also updates other state, so they batch together.
  const [anchor, setAnchor] = useState<Anchor>(INITIAL_ANCHOR);

  // Open: read the live attrs (not a snapshot in case other tabs changed it
  // since the event fired) and dispatch image:deselect so the selection
  // toolbar gets out of the way for the duration of the crop session.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const ce = e as CustomEvent<{
        view: EditorView;
        pos: number;
        element: HTMLElement;
      }>;
      const { view, pos, element } = ce.detail;
      const node = view.state.doc.nodeAt(pos);
      if (node?.type.name !== "image") return;
      const a = node.attrs as {
        src: string;
        naturalW: number;
        naturalH: number;
        crop: CropRect | null;
        rotation: 0 | 90 | 180 | 270;
        flipH: boolean;
        flipV: boolean;
      };
      const openCrop = a.crop ?? FULL;
      setInitialCrop(openCrop);
      setInitialRotation(a.rotation || 0);
      // Seed the anchors to the figure rect — cropFrame matches the
      // figure exactly at open, so all four edge anchors line up there.
      const r = element.getBoundingClientRect();
      setAnchor({
        west: r.left,
        east: r.right,
        north: r.top,
        south: r.bottom,
        cropX: openCrop.x,
        cropY: openCrop.y,
        cropW: openCrop.w,
        cropH: openCrop.h,
      });
      setActiveHandle(null);
      setTarget({
        view,
        pos,
        element,
        src: a.src,
        naturalW: a.naturalW || 0,
        naturalH: a.naturalH || 0,
      });
      setCrop(openCrop);
      setRotation(a.rotation || 0);
      setFlipH(a.flipH);
      setFlipV(a.flipV);
      // Tell the selection toolbar to hide for the crop session.
      document.dispatchEvent(new CustomEvent("image:deselect"));
    };
    document.addEventListener("image:open-crop", onOpen);
    return () => {
      document.removeEventListener("image:open-crop", onOpen);
    };
  }, []);

  // Track the image element's viewport rect (same recipe as
  // ImageSelectionToolbar). The crop frame is portal'd into <body> with
  // `position: fixed` at this rect; the controls popover anchors to it.
  const measure = useCallback(() => {
    if (!target) return;
    const r = target.element.getBoundingClientRect();
    setRect({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, [target]);

  useLayoutEffect(() => {
    if (!target) return;
    // ResizeObserver fires its callback once immediately on `observe(...)`
    // — no explicit initial measure call needed, which keeps the effect
    // off the react-hooks/set-state-in-effect lint.
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

  // Hide the on-page figure (the cropped image rendered in the document)
  // for the duration of the crop session. With visibility:hidden the
  // figure still occupies its layout slot — the surrounding doc flow
  // stays unchanged — but the pixels don't render, so the overlay can't
  // "double up" with the underlying figure when the stage doesn't fully
  // cover its rect (tight crops, after horizontal scaling, etc.).
  useLayoutEffect(() => {
    if (!target) return;
    const el = target.element;
    const previous = el.style.visibility;
    // We're mutating a DOM element's inline style, not the React state
    // value itself; the lint rule's taint tracking can't see that.
    // eslint-disable-next-line react-hooks/immutability
    el.style.visibility = "hidden";
    return () => {
      el.style.visibility = previous;
    };
  }, [target]);

  const close = useCallback(() => {
    setTarget(null);
    setRect(null);
    if (target) {
      // Hand focus back to the editor so the next keypress (notably Cmd-Z
      // to undo the crop) lands on PM's history, not the page. Without
      // this Radix would either restore focus to the now-unmounted
      // popover trigger or drop it on body.
      target.view.focus();
      // Re-fire the selection event so the floating toolbar comes back —
      // the figure is still NodeSelection'd at the PM level; we just need
      // ImageSelectionToolbar to re-acquire the element ref.
      target.element.dispatchEvent(
        new CustomEvent("image:select", {
          bubbles: true,
          detail: {
            view: target.view,
            pos: target.pos,
            element: target.element,
          },
        }),
      );
    }
  }, [target]);

  const apply = useCallback(() => {
    if (!target) return;
    const node = target.view.state.doc.nodeAt(target.pos);
    if (node?.type.name !== "image") {
      close();
      return;
    }
    const isFullCrop =
      crop.x === 0 && crop.y === 0 && crop.w === 100 && crop.h === 100;
    const newCrop = isFullCrop ? FULL : crop;

    // Preserve the user's scale factor across the crop. "Scale" here is
    // how much they'd shrunk or grown the image relative to its true
    // cropped pixel width. If they were at 240px wide on a 300×300 image
    // (full crop), scale = 0.8 — they'd intentionally made the image
    // smaller. After cropping to half height (cropped natural = 300×150),
    // the new rendered width = 0.8 × 300 = 240px (height follows aspect at
    // 120px). If instead they crop the width to half (cropped natural =
    // 150×300), the new rendered width = 0.8 × 150 = 120px — the displayed
    // image shrinks because the cropped region itself shrunk in pixels.
    // Both feel intuitive because the SAME scale carries across crops AND
    // resize-handle interactions.
    const prevAttrs = node.attrs as {
      crop: CropRect | null;
      naturalW: number;
      naturalH: number;
    };
    const prevCrop = prevAttrs.crop ?? FULL;
    const naturalW = prevAttrs.naturalW || 0;
    const naturalH = prevAttrs.naturalH || 0;
    // Rotation 90/270 swaps the effective natural dimensions seen on screen.
    // For tilts in between (Shift+drag rotations) we fall back to unrotated
    // dimensions — the visual is approximate anyway.
    const normalized = ((rotation % 360) + 360) % 360;
    const rotatedSwap =
      (normalized > 45 && normalized < 135) ||
      (normalized > 225 && normalized < 315);
    const effectiveNaturalW = rotatedSwap ? naturalH : naturalW;
    const prevCroppedNaturalW = effectiveNaturalW * (prevCrop.w / 100);
    const newCroppedNaturalW = effectiveNaturalW * (newCrop.w / 100);
    const renderedW = target.element.clientWidth;
    const scale = prevCroppedNaturalW > 0 ? renderedW / prevCroppedNaturalW : 1;
    const newRenderedW = scale * newCroppedNaturalW;

    // Width is stored as fixed pixels (the new widthPx mode). Capping to
    // the figure's containing column happens at render time via the
    // NodeView's max-width:100% rule, so we don't need to clamp here.
    const newWidthPx = Math.max(50, Math.round(newRenderedW));

    const tr = target.view.state.tr.setNodeMarkup(target.pos, undefined, {
      ...node.attrs,
      crop: isFullCrop ? null : crop,
      rotation,
      flipH,
      flipV,
      widthPx: newWidthPx,
      width: 0,
      // Reset the stretch-height. If the user had previously dragged a
      // side handle to set an explicit pixel height, that height would
      // squash the new crop's aspect ratio. Cropping is an aspect-change
      // operation; clear back to natural so the frame's aspect follows
      // the cropped region.
      height: 0,
    });
    target.view.dispatch(tr);
    close();
  }, [close, crop, flipH, flipV, rotation, target]);

  const reset = useCallback(() => {
    setCrop(FULL);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
  }, []);

  // ESC / Enter / click-outside all COMMIT (apply) and close. There's
  // intentionally no cancel — if the user changes their mind, Cmd-Z undoes
  // the commit transaction.
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        apply();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [apply, target]);

  useEffect(() => {
    if (!target) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el?.closest("[data-image-crop]")) return;
      apply();
    };
    // Capture phase so we beat Radix's own popover handling.
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [apply, target]);

  const stageRef = useRef<HTMLDivElement>(null);

  const handlePointer = useCallback(
    (handle: HandleKind, e: React.PointerEvent<HTMLDivElement>) => {
      // Measure against the STAGE's rect (which shows the full natural image),
      // NOT the figure's rect — handles operate in % of the full image so the
      // user can drag back to recover regions hidden by a prior crop.
      const stage = stageRef.current;
      if (!stage) return;
      const stageRect = stage.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const startCrop = crop;
      // No aspect-ratio lock on any handle — corners and sides both let the
      // crop's aspect change freely. (The first-time open still inherits the
      // image's natural aspect because the crop rect starts at full;
      // dragging is what's unconstrained.)
      const lock: number | null = null;
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);

      // Snapshot the cropFrame's edges in screen-space + crop% at drag
      // start. These freeze the OPPOSITE-edge anchor for the current
      // drag: e.g. for a west-handle drag the EAST edge stays glued to
      // anchor.east while the user pulls the west edge around. Both
      // setters batch into the same render, so the geometry math at the
      // bottom of render sees the fresh anchor + activeHandle together.
      setAnchor({
        west: stageRect.left + (stageRect.width * startCrop.x) / 100,
        east:
          stageRect.left +
          (stageRect.width * (startCrop.x + startCrop.w)) / 100,
        north: stageRect.top + (stageRect.height * startCrop.y) / 100,
        south:
          stageRect.top +
          (stageRect.height * (startCrop.y + startCrop.h)) / 100,
        cropX: startCrop.x,
        cropY: startCrop.y,
        cropW: startCrop.w,
        cropH: startCrop.h,
      });
      setActiveHandle(handle);
      // Track the latest crop so onUp can re-anchor against it even
      // before React flushes the last setCrop.
      let latestCrop = startCrop;

      // Drag-past-edge auto-shift. The user-scale stage can extend past the
      // viewport, so dragging toward an off-screen edge will hit the viewport
      // before reaching the crop's limit. To let the drag continue without
      // resorting to Pointer Lock (which hides the cursor + shows a browser
      // notification), accumulate synthetic delta on a rAF loop whenever the
      // cursor is parked within EDGE_PX of a viewport edge. Speed scales
      // with how close to the edge the cursor sits.
      const EDGE_PX = 40;
      const MAX_SPEED_PX = 14;
      let lastX = e.clientX;
      let lastY = e.clientY;
      let extraDx = 0;
      let extraDy = 0;
      let raf: number | null = null;

      const edgeSpeed = (cur: number, max: number): number => {
        if (cur < EDGE_PX) {
          return -MAX_SPEED_PX * (1 - cur / EDGE_PX);
        }
        if (cur > max - EDGE_PX) {
          return MAX_SPEED_PX * (1 - (max - cur) / EDGE_PX);
        }
        return 0;
      };

      const apply = (totalDx: number, totalDy: number) => {
        const dxPct = (totalDx / stageRect.width) * 100;
        const dyPct = (totalDy / stageRect.height) * 100;
        const next = resizeOrPan(handle, startCrop, dxPct, dyPct, lock);
        latestCrop = next;
        setCrop(next);
      };

      const tick = () => {
        const vx = edgeSpeed(lastX, window.innerWidth);
        const vy = edgeSpeed(lastY, window.innerHeight);
        if (vx === 0 && vy === 0) {
          raf = null;
          return;
        }
        extraDx += vx;
        extraDy += vy;
        apply(lastX - startX + extraDx, lastY - startY + extraDy);
        raf = requestAnimationFrame(tick);
      };

      const onMove = (ev: PointerEvent) => {
        lastX = ev.clientX;
        lastY = ev.clientY;
        apply(ev.clientX - startX + extraDx, ev.clientY - startY + extraDy);
        // Kick off the rAF loop the moment the cursor enters an edge band
        // and the user is still dragging. The loop self-cancels in `tick`
        // once the cursor moves away from the edges.
        if (raf === null) {
          const vx = edgeSpeed(lastX, window.innerWidth);
          const vy = edgeSpeed(lastY, window.innerHeight);
          if (vx !== 0 || vy !== 0) {
            raf = requestAnimationFrame(tick);
          }
        }
      };
      const onUp = () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        if (raf !== null) {
          cancelAnimationFrame(raf);
          raf = null;
        }
        // Re-anchor on the FINAL crop + stage so the at-rest geometry
        // matches what the user just left on screen (no jump when the
        // active-handle anchor formula switches back to default).
        const finalStage = stageRef.current?.getBoundingClientRect();
        if (finalStage) {
          setAnchor({
            west: finalStage.left + (finalStage.width * latestCrop.x) / 100,
            east:
              finalStage.left +
              (finalStage.width * (latestCrop.x + latestCrop.w)) / 100,
            north: finalStage.top + (finalStage.height * latestCrop.y) / 100,
            south:
              finalStage.top +
              (finalStage.height * (latestCrop.y + latestCrop.h)) / 100,
            cropX: latestCrop.x,
            cropY: latestCrop.y,
            cropW: latestCrop.w,
            cropH: latestCrop.h,
          });
        }
        setActiveHandle(null);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    },
    [crop],
  );

  const imageStyle = useMemo<React.CSSProperties>(() => {
    const sx = flipH ? -1 : 1;
    const sy = flipV ? -1 : 1;
    return {
      transform: `rotate(${String(rotation)}deg) scale(${String(sx)}, ${String(sy)})`,
      transformOrigin: "center center",
    };
  }, [flipH, flipV, rotation]);

  if (!target || !rect) return null;

  // Stage shows the FULL underlying image at its natural aspect ratio so the
  // crop handles can range over the entire original — not just the prior
  // crop's visible portion.
  //
  // Sizing rule: match the user's CURRENT pixel scale. The cropped figure on
  // page has `crop.w%` of natural width compressed into `figW` screen px, so
  // the natural image at the same scale is `figW × 100/crop.w` wide. Display
  // the stage at that size and the bright crop frame inside lands at the
  // exact same on-screen size the cropped figure had — no jarring shrink-
  // when-entering-crop. The stage img stays at the natural aspect ratio so
  // the underlying image looks correct regardless of any prior side-handle
  // stretch on the figure.
  //
  // Cap: if the user-scale stage would exceed the figure's containing
  // column, fit-to-column instead. The bright crop frame inside necessarily
  // ends up smaller than the cropped figure in that case — the trade-off
  // when the full natural at user-scale doesn't physically fit on screen.
  //
  // Position: shift the stage so the crop frame's screen position equals
  // the on-page cropped figure's rect. The cropped sub-region stays put;
  // the rest of the natural image appears around it at matching scale.
  // Stage geometry math.
  //
  // The cropFrame has four screen-space edges. For each axis, ONE edge
  // is "anchored" (stays glued to a fixed screen position during the
  // current drag); the OTHER edge moves with the user's cursor. The
  // anchored edge is the OPPOSITE of the handle being dragged: west
  // anchored for east-handle drags, east anchored for west-handle
  // drags, north for south, south for north. Pan and at-rest both use
  // west+north anchors so the crop rectangle translates with the
  // cursor.
  //
  // anchorRef captures the cropFrame edges + crop% at drag start so the
  // anchor stays consistent across the drag, and is updated on drag end
  // so the at-rest default anchor reflects the new state with no jump.
  //
  // Horizontal has a panel cap (`.ProseMirror`): when the dragged edge
  // would push the cropFrame past the panel's left/right boundary, the
  // stage scales DOWN uniformly so the binding edge pins to that
  // boundary. Vertical has no panel cap — the stage can extend above or
  // below the figure freely.
  const rotated = initialRotation % 180 !== 0;
  const naturalAspect =
    target.naturalW > 0 && target.naturalH > 0
      ? rotated
        ? target.naturalH / target.naturalW
        : target.naturalW / target.naturalH
      : (rect.width ?? 0) / Math.max(1, rect.height ?? 0);
  const figW = rect.width ?? 0;
  const figH = rect.height ?? 0;
  const safeAspect = Math.max(0.01, naturalAspect);
  const openCropW = Math.max(1, initialCrop.w);

  // Ideal stage size at user-scale (figure's px-per-natural-px ratio at
  // open). Stays frozen for the session.
  const stageW_ideal = (figW * 100) / openCropW;
  const stageH_ideal = stageW_ideal / safeAspect;

  const xAnchorIsEast =
    activeHandle === "w" || activeHandle === "sw" || activeHandle === "nw";
  const yAnchorIsSouth =
    activeHandle === "n" || activeHandle === "ne" || activeHandle === "nw";

  // anchorCropW / anchorCropH = the crop dimensions at the anchor moment.
  // For X-axis with E anchor (w-handle drags), cropX + cropW stays constant
  // during the drag = anchor.cropX + anchor.cropW. With W anchor the
  // dragged edge is cropFrame.east = anchorWest + stageW × cropW/100. The
  // factor that drives the panel constraint is the CURRENT crop.w.
  const panel =
    target.element.closest(".ProseMirror") ?? target.element.parentElement;
  const panelRect = panel?.getBoundingClientRect();

  // Horizontal panel-boundary scale.
  let maxStageW = Number.POSITIVE_INFINITY;
  if (panelRect && crop.w > 0) {
    if (xAnchorIsEast) {
      // cropFrame.west = anchor.east - stageW × crop.w/100 ≥ panel.left.
      const room = anchor.east - panelRect.left;
      if (room < stageW_ideal * (crop.w / 100)) {
        maxStageW = Math.min(maxStageW, (room * 100) / crop.w);
      }
    } else {
      // cropFrame.east = anchor.west + stageW × crop.w/100 ≤ panel.right.
      const room = panelRect.right - anchor.west;
      if (room < stageW_ideal * (crop.w / 100)) {
        maxStageW = Math.min(maxStageW, (room * 100) / crop.w);
      }
    }
  }
  const horizScale = Math.max(0.001, Math.min(1, maxStageW / stageW_ideal));
  const stageWidth = stageW_ideal * horizScale;
  // Bleed-through guard for side-handle-stretched figures (taller than
  // natural-aspect height would cover).
  const stageHeight = Math.max(figH, stageH_ideal * horizScale);

  // Compute stage position from the chosen anchor edge.
  const stageX = xAnchorIsEast
    ? anchor.east - (stageWidth * (anchor.cropX + anchor.cropW)) / 100
    : anchor.west - (stageWidth * anchor.cropX) / 100;
  const stageY = yAnchorIsSouth
    ? anchor.south - (stageHeight * (anchor.cropY + anchor.cropH)) / 100
    : anchor.north - (stageHeight * anchor.cropY) / 100;

  // Portal the crop frame to <body> so it isn't clipped by editor overflow
  // and renders above other UI. Position: fixed at the figure's x/y, sized
  // to the FULL image's natural aspect so the user can drag the crop frame
  // anywhere across the original — not just the prior crop's visible region.
  const frame = createPortal(
    <div
      ref={stageRef}
      data-image-crop="frame"
      className="pointer-events-auto fixed bg-background select-none"
      style={{
        left: stageX,
        top: stageY,
        width: stageWidth,
        height: stageHeight,
        zIndex: 50,
      }}
    >
      {/* Underlying image preview — the FULL untransformed image at the
          stage's natural-aspect size. NO object-cover (which would re-crop
          to the stage rect). Rotation/flip transforms live on the <img>
          itself via `imageStyle`. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={target.src}
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={imageStyle}
      />

      {/* Dim mask outside the crop rect: four absolute panels. */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute bg-foreground/45"
          style={{ left: 0, top: 0, right: 0, height: `${String(crop.y)}%` }}
        />
        <div
          className="absolute bg-foreground/45"
          style={{
            left: 0,
            top: `${String(crop.y + crop.h)}%`,
            right: 0,
            bottom: 0,
          }}
        />
        <div
          className="absolute bg-foreground/45"
          style={{
            left: 0,
            top: `${String(crop.y)}%`,
            width: `${String(crop.x)}%`,
            height: `${String(crop.h)}%`,
          }}
        />
        <div
          className="absolute bg-foreground/45"
          style={{
            left: `${String(crop.x + crop.w)}%`,
            top: `${String(crop.y)}%`,
            right: 0,
            height: `${String(crop.h)}%`,
          }}
        />
      </div>

      {/* Interactive crop frame + 8 handles. */}
      <div
        className="absolute touch-none border border-background shadow-md"
        style={{
          left: `${String(crop.x)}%`,
          top: `${String(crop.y)}%`,
          width: `${String(crop.w)}%`,
          height: `${String(crop.h)}%`,
          cursor: "move",
        }}
        onPointerDown={(e) => {
          handlePointer("pan", e);
        }}
      >
        {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map((k) => (
          <div
            key={k}
            data-handle={k}
            className={`absolute size-3 border border-background bg-primary ${HANDLE_POS[k]}`}
            style={{ touchAction: "none", cursor: HANDLE_CURSOR[k] }}
            onPointerDown={(e) => {
              e.stopPropagation();
              handlePointer(k, e);
            }}
          />
        ))}
      </div>
    </div>,
    document.body,
  );

  // Anchor the controls popover to the STAGE rect (not the figure rect) so
  // it sits below the visible crop UI rather than partway up the stage.
  const stageRect: VirtualRect = {
    x: stageX,
    y: stageY,
    width: stageWidth,
    height: stageHeight,
  };

  return (
    <>
      {frame}
      <VirtualAnchorPopover
        rect={stageRect}
        open
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <PopoverContent
          role="toolbar"
          aria-label="Crop controls"
          side="bottom"
          align="center"
          sideOffset={12}
          // Don't let Radix yank focus into the popover on open or out of
          // the editor on close — PM keeps the NodeSelection across the
          // crop session so Cmd-Z after Apply lands on PM's history.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
          // Keep PM focus / NodeSelection while interacting with controls.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          // Radix's outside-click detection treats anything outside the
          // popover content (this toolbar) as a dismiss. The crop stage and
          // its handles ARE outside the toolbar, so without these guards
          // every drag inside the crop region tears down the overlay. Allow
          // interactions that target the stage to pass through harmlessly.
          onPointerDownOutside={(event) => {
            const t = event.target as Element | null;
            if (t?.closest("[data-image-crop]")) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            const t = event.target as Element | null;
            if (t?.closest("[data-image-crop]")) event.preventDefault();
          }}
          // Mark so the click-outside-commit handler knows clicks inside the
          // popover should NOT commit / close the crop session.
          data-image-crop="controls"
          className="flex items-center gap-1 p-1"
        >
          <CropIconButton
            icon={<RotateCcw className="size-4" />}
            label="Rotate left"
            onClick={() => {
              setRotation(((rotation + 270) % 360) as 0 | 90 | 180 | 270);
            }}
          />
          <CropIconButton
            icon={<RotateCw className="size-4" />}
            label="Rotate right"
            onClick={() => {
              setRotation(((rotation + 90) % 360) as 0 | 90 | 180 | 270);
            }}
          />
          <CropIconButton
            icon={<FlipHorizontal className="size-4" />}
            label="Flip horizontally"
            onClick={() => {
              setFlipH(!flipH);
            }}
          />
          <CropIconButton
            icon={<FlipVertical className="size-4" />}
            label="Flip vertically"
            onClick={() => {
              setFlipV(!flipV);
            }}
          />
          <Separator orientation="vertical" className="mx-1 h-5 self-center" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                onClick={reset}
              >
                Reset
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset crop, rotation, and flips</TooltipContent>
          </Tooltip>
        </PopoverContent>
      </VirtualAnchorPopover>
    </>
  );
}

/** Icon button for the crop controls popover. Matches the selection
 *  toolbar's `ToolbarButton` (tooltip + focus-preserving onMouseDown) so
 *  the two popovers feel like one design system. */
function CropIconButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
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

// ---------------------------------------------------------------------------
// Crop math
// ---------------------------------------------------------------------------

type HandleKind = "pan" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const HANDLE_POS: Record<Exclude<HandleKind, "pan">, string> = {
  n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2",
  s: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2",
  e: "right-0 top-1/2 -translate-y-1/2 translate-x-1/2",
  w: "left-0 top-1/2 -translate-y-1/2 -translate-x-1/2",
  ne: "right-0 top-0 -translate-y-1/2 translate-x-1/2",
  nw: "left-0 top-0 -translate-y-1/2 -translate-x-1/2",
  se: "right-0 bottom-0 translate-y-1/2 translate-x-1/2",
  sw: "left-0 bottom-0 translate-y-1/2 -translate-x-1/2",
};

const HANDLE_CURSOR: Record<Exclude<HandleKind, "pan">, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  sw: "nesw-resize",
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Apply a pointer delta to the crop rect according to which handle is being
 *  dragged. `lockRatio` (when non-null) forces the resize to preserve the
 *  aspect ratio by deriving the smaller axis from the larger. */
function resizeOrPan(
  kind: HandleKind,
  start: CropRect,
  dx: number,
  dy: number,
  lockRatio: number | null,
): CropRect {
  if (kind === "pan") {
    // Pan = drag the crop RECTANGLE around within the rigid stage
    // (react-image-crop convention). Cursor direction = crop motion
    // direction — drag right moves the rectangle right, exposing
    // content from the right side of the natural image under it. The
    // earlier Photoshop "hand-tool" inversion only made sense when the
    // stage itself shifted; with a rigid stage it just feels backwards.
    const x = clamp(start.x + dx, 0, 100 - start.w);
    const y = clamp(start.y + dy, 0, 100 - start.h);
    return { ...start, x, y };
  }
  let { x, y, w, h } = start;
  if (kind.includes("w")) {
    x = clamp(start.x + dx, 0, start.x + start.w - 5);
    w = start.w + (start.x - x);
  }
  if (kind.includes("e")) {
    w = clamp(start.w + dx, 5, 100 - start.x);
  }
  if (kind.includes("n")) {
    y = clamp(start.y + dy, 0, start.y + start.h - 5);
    h = start.h + (start.y - y);
  }
  if (kind.includes("s")) {
    h = clamp(start.h + dy, 5, 100 - start.y);
  }
  if (lockRatio !== null) {
    const wantedH = w / lockRatio;
    if (wantedH <= h) {
      if (kind.includes("n")) {
        y = clamp(y + (h - wantedH), 0, y + h - 5);
      }
      h = wantedH;
    } else {
      const wantedW = h * lockRatio;
      if (kind.includes("w")) {
        x = clamp(x + (w - wantedW), 0, x + w - 5);
      }
      w = wantedW;
    }
    w = clamp(w, 5, 100 - x);
    h = clamp(h, 5, 100 - y);
  }
  return { x, y, w, h };
}

/* fitAspect + currentAspectRatio removed with the aspect-preset dropdown —
 * corner-resize aspect lock is now derived from the crop's live shape
 * directly in handlePointer. */
