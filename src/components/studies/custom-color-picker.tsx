"use client";

import { useTheme } from "next-themes";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  contrastRatioOklch,
  INK_COLOR_DARK,
  INK_COLOR_LIGHT,
  meetsContrastAA,
  PAGE_BG_DARK,
  PAGE_BG_LIGHT,
} from "@/lib/editor/format-colors";
import {
  type HsvParts,
  hexToOklch,
  hsvToOklch,
  hsvToSrgb,
  oklchToHex,
  oklchToHsv,
} from "@/lib/editor/oklch";
import { cn } from "@/lib/utils";

/**
 * The custom-colour picker mounted from the selection-bubble / toolbar
 * `ColorControl` when the user clicks "+ Custom".
 *
 * Design notes:
 *   - The 2D plane is a custom canvas, NOT `react-colorful`. We remap the
 *     plane so its entire surface shows only colours that pass 4.5:1
 *     contrast against the surface-specific target (so there's no mask
 *     and no clamp — every pixel under the drag handle is already valid).
 *     The remap is two-step at the current hue: (1) find the saturation
 *     window `[s_lo, s_hi]` where ANY valid V exists and stretch the
 *     picker's full width onto it; (2) per saturation column, find the V
 *     window `[v_lo(s), v_hi(s)]` and stretch the picker's full height
 *     onto it. Top of the picker = lightest valid V at that column (read:
 *     more pastel for highlights / lighter for text); bottom = darkest.
 *   - "Dead hues" — hues where no (s, v) clears 4.5:1 at all — collapse
 *     the plane to the highest-contrast colour we could find for that hue
 *     (still failing). Apply is disabled with an inline message; the user
 *     drags the hue slider away to escape.
 *   - The hue slider is also custom (react-colorful has no standalone
 *     hue export). It's a tiny horizontal rainbow + draggable thumb.
 *   - Hex paste accepts a valid+passing hex and snaps the picker handle
 *     to the (x, y) point on the remapped plane that corresponds to that
 *     hue/saturation/value. An invalid or low-contrast hex shakes the
 *     input + shows an inline message, no state change.
 *   - Theme target re-derives on `resolvedTheme` change. Highlights
 *     validate against the default ink colour; text colour validates
 *     against the page background.
 */
export interface CustomColorPickerProps {
  surface: "highlight" | "textColor";
  /** The colour to seed the picker with (the existing mark, or null). */
  initial?: string | null;
  onApply: (oklch: string) => void;
  onCancel: () => void;
}

const PLANE_W = 220;
const PLANE_H = 160;
const HUE_BAR_H = 14;
/** Resolution of saturation samples used to build the per-hue LUT. */
const LUT_X_SAMPLES = 96;
/** Resolution of V samples used to find each column's [v_lo, v_hi] window. */
const LUT_V_SAMPLES = 48;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ---------------------------------------------------------------------------
// Per-hue LUT — the heart of the remap
// ---------------------------------------------------------------------------

/**
 * The remap LUT for a single hue + contrast target.
 *
 * `satLo`/`satHi` are 0..100 (HSV-space) and bound the saturation window
 * where SOME valid V exists; the picker's full width [0, 1] stretches onto
 * `[satLo, satHi]`. `vLo[i]`/`vHi[i]` are 0..100 V windows at
 * `LUT_X_SAMPLES` evenly-spaced points along that window — the picker's
 * full height [0, 1] (top→bottom) maps to `[vHi[i] → vLo[i]]`.
 *
 * `deadHue` is set when no (s, v) anywhere at this hue clears 4.5:1; the
 * plane collapses to the `fallback` colour and Apply is disabled.
 */
interface Lut {
  hue: number;
  deadHue: boolean;
  /** Best-effort uniform colour shown at dead hues. */
  fallback: HsvParts;
  satLo: number;
  satHi: number;
  /** V windows at each of LUT_X_SAMPLES across [satLo, satHi]. */
  vLo: Float32Array;
  vHi: Float32Array;
}

/**
 * Find the [v_lo, v_hi] window at fixed hue+saturation where contrast clears
 * threshold. Linear scan over `LUT_V_SAMPLES` because the contrast function
 * isn't strictly monotonic in V at every (h, s) — binary search could miss a
 * disjoint valid interval. Returns null when nothing passes.
 */
function valueWindow(
  hue: number,
  s: number,
  target: string,
): { lo: number; hi: number } | null {
  let lo = -1;
  let hi = -1;
  for (let i = 0; i < LUT_V_SAMPLES; i++) {
    const v = (i / (LUT_V_SAMPLES - 1)) * 100;
    if (meetsContrastAA(hsvToOklch({ h: hue, s, v }), target)) {
      if (lo < 0) lo = v;
      hi = v;
    }
  }
  return lo < 0 ? null : { lo, hi };
}

/**
 * Best-effort colour at a dead hue: the (s, v) with the highest contrast
 * ratio we could find. Shown uniformly across the plane; Apply stays
 * disabled because the colour still doesn't clear 4.5:1.
 */
function bestEffortAtHue(hue: number, target: string): HsvParts {
  let bestRatio = 0;
  let best: HsvParts = { h: hue, s: 100, v: 50 };
  for (let xi = 0; xi <= 16; xi++) {
    const s = (xi / 16) * 100;
    for (let yi = 0; yi <= 16; yi++) {
      const v = (yi / 16) * 100;
      const ratio = contrastRatioOklch(hsvToOklch({ h: hue, s, v }), target);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = { h: hue, s, v };
      }
    }
  }
  return best;
}

function computeLut(hue: number, target: string): Lut {
  // First pass: scan saturation, find the window where any valid V exists.
  // Use a coarse scan for the windowing pass; the picker uses LUT_X_SAMPLES
  // for the actual per-column data.
  let satLo = -1;
  let satHi = -1;
  const SCAN = 48;
  for (let i = 0; i < SCAN; i++) {
    const s = (i / (SCAN - 1)) * 100;
    if (valueWindow(hue, s, target) !== null) {
      if (satLo < 0) satLo = s;
      satHi = s;
    }
  }
  if (satLo < 0) {
    // Dead hue: no valid colour at all. Collapse the plane.
    return {
      hue,
      deadHue: true,
      fallback: bestEffortAtHue(hue, target),
      satLo: 0,
      satHi: 100,
      vLo: new Float32Array(LUT_X_SAMPLES),
      vHi: new Float32Array(LUT_X_SAMPLES),
    };
  }
  // Second pass: sample LUT_X_SAMPLES uniformly across [satLo, satHi] and
  // record each column's V window. A column inside the saturation window
  // can still have no valid V (the window check above looks at coarser
  // saturation steps); when that happens we carry the neighbour's bounds
  // forward so the picker stays smooth.
  const vLo = new Float32Array(LUT_X_SAMPLES);
  const vHi = new Float32Array(LUT_X_SAMPLES);
  let lastLo = 50;
  let lastHi = 50;
  for (let i = 0; i < LUT_X_SAMPLES; i++) {
    const t = i / (LUT_X_SAMPLES - 1);
    const s = satLo + t * (satHi - satLo);
    const w = valueWindow(hue, s, target);
    if (w) {
      vLo[i] = w.lo;
      vHi[i] = w.hi;
      lastLo = w.lo;
      lastHi = w.hi;
    } else {
      vLo[i] = lastLo;
      vHi[i] = lastHi;
    }
  }
  return {
    hue,
    deadHue: false,
    fallback: { h: hue, s: 0, v: 0 },
    satLo,
    satHi,
    vLo,
    vHi,
  };
}

// ---------------------------------------------------------------------------
// Forward / inverse picker mapping
// ---------------------------------------------------------------------------

/**
 * Picker (x, y) ∈ [0, 1]² → HSV at the LUT's hue.
 *
 * We linearly interpolate the V window between the two LUT columns straddling
 * `x`. With LUT_X_SAMPLES across a 220 px wide canvas, nearest-neighbour
 * lookup would quantise V-window boundaries into vertical bands ~2 px wide —
 * visually choppy because adjacent columns can have meaningfully different
 * `[vLo, vHi]` extents. Lerp removes the steps so the gradient is continuous.
 */
function pickerToHsv(x: number, y: number, lut: Lut): HsvParts {
  if (lut.deadHue) {
    return lut.fallback;
  }
  const xc = clamp01(x);
  const yc = clamp01(y);
  const s = lut.satLo + xc * (lut.satHi - lut.satLo);
  const fIdx = xc * (LUT_X_SAMPLES - 1);
  const idx0 = Math.floor(fIdx);
  const idx1 = Math.min(LUT_X_SAMPLES - 1, idx0 + 1);
  const t = fIdx - idx0;
  const vLo0 = lut.vLo[idx0] ?? 0;
  const vLo1 = lut.vLo[idx1] ?? vLo0;
  const vHi0 = lut.vHi[idx0] ?? 100;
  const vHi1 = lut.vHi[idx1] ?? vHi0;
  const vLo = vLo0 + (vLo1 - vLo0) * t;
  const vHi = vHi0 + (vHi1 - vHi0) * t;
  // Top of picker (y=0) = max V at this column; bottom (y=1) = min V.
  const v = vHi + (vLo - vHi) * yc;
  return { h: lut.hue, s, v };
}

/**
 * HSV → picker (x, y). Used to seed the picker from an existing colour and to
 * snap on hex paste. Clamps inputs that fall outside the current LUT window
 * (e.g. a paste at the same hue but a (s, v) that's at the edge of the valid
 * region).
 */
function hsvToPicker(hsv: HsvParts, lut: Lut): { x: number; y: number } {
  if (lut.deadHue) return { x: 0.5, y: 0.5 };
  const width = lut.satHi - lut.satLo;
  const x = width > 0 ? clamp01((hsv.s - lut.satLo) / width) : 0.5;
  const idx = Math.min(
    LUT_X_SAMPLES - 1,
    Math.max(0, Math.round(x * (LUT_X_SAMPLES - 1))),
  );
  const vLo = lut.vLo[idx] ?? 0;
  const vHi = lut.vHi[idx] ?? 100;
  const range = vHi - vLo;
  const y = range > 0 ? clamp01((vHi - hsv.v) / range) : 0.5;
  return { x, y };
}

// ---------------------------------------------------------------------------
// Canvas paint
// ---------------------------------------------------------------------------

/**
 * Paint the remapped colour field for the current LUT. Renders at devicePixel
 * resolution. Cheap — ~35k pixels × a HSV→sRGB conversion per pixel, well
 * under a frame on any modern device.
 */
function paintPlane(canvas: HTMLCanvasElement, lut: Lut): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = Math.round(PLANE_W * dpr);
  const h = Math.round(PLANE_H * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (lut.deadHue) {
    const [r, g, b] = hsvToSrgb(lut.fallback);
    ctx.fillStyle = `rgb(${String(Math.round(r * 255))} ${String(Math.round(g * 255))} ${String(Math.round(b * 255))})`;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const img = ctx.createImageData(w, h);
  for (let py = 0; py < h; py++) {
    const yt = py / (h - 1);
    for (let px = 0; px < w; px++) {
      const xt = px / (w - 1);
      const { s, v } = pickerToHsv(xt, yt, lut);
      const [r, g, b] = hsvToSrgb({ h: lut.hue, s, v });
      const i = (py * w + px) * 4;
      img.data[i] = Math.round(r * 255);
      img.data[i + 1] = Math.round(g * 255);
      img.data[i + 2] = Math.round(b * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

interface PickerState {
  /** 0..360 */
  hue: number;
  /** Position on the remapped plane, 0..1 in each axis. */
  x: number;
  y: number;
}

/** Sensible seed when the user opens the picker fresh. */
function defaultStateFor(surface: "highlight" | "textColor"): {
  hue: number;
  x: number;
  y: number;
} {
  return surface === "highlight"
    ? { hue: 50, x: 0.4, y: 0.1 }
    : { hue: 220, x: 0.7, y: 0.6 };
}

export function CustomColorPicker({
  surface,
  initial,
  onApply,
  onCancel,
}: CustomColorPickerProps): React.ReactElement {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const target =
    surface === "highlight"
      ? isDark
        ? INK_COLOR_DARK
        : INK_COLOR_LIGHT
      : isDark
        ? PAGE_BG_DARK
        : PAGE_BG_LIGHT;

  // Initial state: derive from `initial` colour if it parses + passes
  // contrast in the current theme. We compute the LUT inline in the
  // initializer so the (x, y) snap can land on the right point synchronously
  // — no useEffect-then-setState dance (which violates the project's
  // no-setState-in-effect rule). `target` is read at mount time; subsequent
  // theme changes recompute the LUT through the `useMemo` below and the
  // handle stays at the user's last (x, y) on purpose.
  const [state, setState] = useState<PickerState>(() => {
    const initialHsv = initial ? oklchToHsv(initial) : null;
    if (initialHsv && initial && meetsContrastAA(initial, target)) {
      const seedLut = computeLut(initialHsv.h, target);
      const { x, y } = hsvToPicker(initialHsv, seedLut);
      return { hue: initialHsv.h, x, y };
    }
    const seed = defaultStateFor(surface);
    return { hue: seed.hue, x: seed.x, y: seed.y };
  });

  // LUT memoized on (hue, target). Recomputes when the user drags the hue
  // slider or switches themes.
  const lut = useMemo(() => computeLut(state.hue, target), [state.hue, target]);

  // Current HSV / OKLCH derived from picker state + LUT.
  const currentHsv = useMemo(
    () => pickerToHsv(state.x, state.y, lut),
    [state.x, state.y, lut],
  );
  const oklchValue = useMemo(() => hsvToOklch(currentHsv), [currentHsv]);

  // Hex input — controlled with an optional "draft" so the user can type
  // freely without the picker overwriting their value mid-edit. Cleared on
  // successful commit.
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [hexError, setHexError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const canonicalHex = useMemo(
    () => oklchToHex(oklchValue) ?? "",
    [oklchValue],
  );
  const hexInputValue = hexDraft ?? canonicalHex;

  // --- 2D plane canvas + pointer events -----------------------------------
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    paintPlane(canvas, lut);
  }, [lut]);

  const planeRef = useRef<HTMLDivElement>(null);
  const updateFromPointer = useCallback((clientX: number, clientY: number) => {
    const el = planeRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = clamp01((clientX - rect.left) / rect.width);
    const y = clamp01((clientY - rect.top) / rect.height);
    setState((prev) => ({ ...prev, x, y }));
  }, []);
  const planePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event.clientX, event.clientY);
  };
  const planePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateFromPointer(event.clientX, event.clientY);
  };
  const planePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const planeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setState((prev) => ({ ...prev, x: clamp01(prev.x - step) }));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setState((prev) => ({ ...prev, x: clamp01(prev.x + step) }));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setState((prev) => ({ ...prev, y: clamp01(prev.y - step) }));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setState((prev) => ({ ...prev, y: clamp01(prev.y + step) }));
    }
  };

  // --- Hue slider (custom — react-colorful has no standalone hue export) --
  const hueBarRef = useRef<HTMLDivElement>(null);
  const updateHueFromPointer = useCallback((clientX: number) => {
    const el = hueBarRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const t = clamp01((clientX - rect.left) / rect.width);
    setState((prev) => ({ ...prev, hue: t * 360 }));
  }, []);
  const huePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateHueFromPointer(event.clientX);
  };
  const huePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateHueFromPointer(event.clientX);
  };
  const huePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const hueKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 15 : 3;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setState((prev) => ({ ...prev, hue: (prev.hue - step + 360) % 360 }));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setState((prev) => ({ ...prev, hue: (prev.hue + step) % 360 }));
    }
  };

  // --- Hex input -----------------------------------------------------------
  const commitHex = useCallback(
    (raw: string) => {
      const oklch = hexToOklch(raw);
      if (!oklch) {
        setHexError("Enter a hex like #b91c1c.");
        setShake(true);
        window.setTimeout(() => {
          setShake(false);
        }, 320);
        return;
      }
      if (!meetsContrastAA(oklch, target)) {
        setHexError(
          surface === "highlight"
            ? "That colour is too dark to highlight — try a lighter shade."
            : "That colour is too light to read here — try a darker shade.",
        );
        setShake(true);
        window.setTimeout(() => {
          setShake(false);
        }, 320);
        return;
      }
      const hsv = oklchToHsv(oklch);
      if (!hsv) return;
      // Recompute the LUT at the pasted hue and snap (x, y).
      const pastedLut = computeLut(hsv.h, target);
      const { x, y } = hsvToPicker(hsv, pastedLut);
      setState({ hue: hsv.h, x, y });
      setHexError(null);
      setHexDraft(null);
    },
    [surface, target],
  );

  // --- Apply ---------------------------------------------------------------
  const applyDisabled = lut.deadHue;
  const handleApply = () => {
    if (applyDisabled) return;
    // Belt-and-braces: even though the LUT keeps every reachable point
    // valid, a future LUT bug shouldn't ship an unreadable colour.
    if (!meetsContrastAA(oklchValue, target)) return;
    onApply(oklchValue);
  };

  // Preview swatch (left of hex input) — straight HSV→sRGB so it matches
  // the canvas pixel under the handle exactly.
  const previewBg = (() => {
    const [r, g, b] = hsvToSrgb(currentHsv);
    return `rgb(${String(Math.round(r * 255))} ${String(Math.round(g * 255))} ${String(Math.round(b * 255))})`;
  })();

  return (
    <div
      onMouseDown={(event) => {
        // Hosted inside the selection bubble's color popover; cancel native
        // mousedown so opening this picker doesn't blur the editor (the
        // bubble is gated on editor focus — losing it would dismiss the
        // bubble). Pointer events on the plane / hue bar call
        // `event.preventDefault()` themselves to suppress text selection
        // during drag, and that doesn't conflict with this outer guard.
        event.preventDefault();
      }}
      className="flex flex-col gap-2 p-2"
      style={shake ? { animation: "shake 320ms ease-in-out" } : undefined}
      role="dialog"
      aria-label={
        surface === "highlight"
          ? "Custom highlight colour"
          : "Custom text colour"
      }
    >
      {/* 2D plane. Not `role="slider"` because that role requires a single
          `aria-valuenow`; this is a 2D widget. WAI-ARIA's "two coupled
          sliders" pattern needs nested elements that would conflict with
          our pointer-capture model, so we settle for a focusable region
          with a descriptive label + the live hex in `aria-valuetext`. */}
      <div
        ref={planeRef}
        tabIndex={0}
        aria-label={
          surface === "highlight"
            ? "Highlight colour, saturation horizontal, lightness vertical"
            : "Text colour, saturation horizontal, lightness vertical"
        }
        aria-valuetext={canonicalHex || "no colour"}
        onPointerDown={planePointerDown}
        onPointerMove={planePointerMove}
        onPointerUp={planePointerUp}
        onPointerCancel={planePointerUp}
        onKeyDown={planeKeyDown}
        className="relative outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        style={{
          width: PLANE_W,
          height: PLANE_H,
          touchAction: "none",
          borderRadius: 6,
          cursor: "crosshair",
        }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden
          style={{
            width: PLANE_W,
            height: PLANE_H,
            display: "block",
            borderRadius: 6,
            pointerEvents: "none",
          }}
        />
        {/* Handle — non-interactive, positioned over the plane. */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: `${String(state.x * PLANE_W)}px`,
            top: `${String(state.y * PLANE_H)}px`,
            width: 14,
            height: 14,
            transform: "translate(-50%, -50%)",
            borderRadius: "9999px",
            background: previewBg,
            boxShadow:
              "0 0 0 2px var(--surface), 0 0 0 3px var(--picker-handle-shadow), 0 1px 3px var(--picker-handle-shadow)",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Hue slider */}
      <div
        ref={hueBarRef}
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(state.hue)}
        onPointerDown={huePointerDown}
        onPointerMove={huePointerMove}
        onPointerUp={huePointerUp}
        onPointerCancel={huePointerUp}
        onKeyDown={hueKeyDown}
        className="relative outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        style={{
          width: PLANE_W,
          height: HUE_BAR_H,
          touchAction: "none",
          borderRadius: 6,
          cursor: "ew-resize",
          background:
            "linear-gradient(to right, #ff0000 0%, #ffff00 16.6%, #00ff00 33.3%, #00ffff 50%, #0000ff 66.6%, #ff00ff 83.3%, #ff0000 100%)",
        }}
      >
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: `${String((state.hue / 360) * PLANE_W)}px`,
            top: "50%",
            width: 10,
            height: HUE_BAR_H + 4,
            transform: "translate(-50%, -50%)",
            borderRadius: 3,
            background: "transparent",
            boxShadow:
              "0 0 0 2px var(--surface), 0 0 0 3px var(--picker-handle-shadow), 0 1px 3px var(--picker-handle-shadow)",
            pointerEvents: "none",
          }}
        />
      </div>

      {lut.deadHue ? (
        <p role="alert" className="text-caption text-muted-foreground">
          No readable colour at this hue — drag the slider to a different hue to
          continue.
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block size-7 shrink-0 rounded-md ring-1 ring-foreground/15"
          style={{ backgroundColor: previewBg }}
        />
        <label className="sr-only" htmlFor="custom-color-hex">
          Hex value
        </label>
        <input
          id="custom-color-hex"
          type="text"
          inputMode="text"
          spellCheck={false}
          autoComplete="off"
          value={hexInputValue}
          onChange={(event) => {
            setHexDraft(event.target.value);
            setHexError(null);
          }}
          onBlur={(event) => {
            commitHex(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitHex(hexInputValue);
            }
          }}
          className={cn(
            "flex h-7 w-24 rounded-md border border-input bg-background px-2 font-mono text-caption outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            hexError && "border-destructive ring-1 ring-destructive/40",
          )}
          aria-invalid={hexError ? true : undefined}
          aria-describedby={hexError ? "custom-color-hex-error" : undefined}
        />
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleApply}
            disabled={applyDisabled}
          >
            Apply
          </Button>
        </div>
      </div>
      {hexError ? (
        <p
          id="custom-color-hex-error"
          role="alert"
          className="text-caption text-destructive"
        >
          {hexError}
        </p>
      ) : null}
    </div>
  );
}
