/**
 * Pointer-based drag-to-reorder for vertical lists. Framework-agnostic: it does
 * the pointer math and renders a floating drop indicator, then reports the
 * committed move through `onReorder(from, to)` (array-move semantics — the item
 * at `from` ends up at index `to`). The caller performs the actual reorder (a
 * ProseMirror transaction, a React state update + server action, …) and lets
 * the list re-render itself; this helper never mutates list structure, so it
 * coexists with both ProseMirror's and React's own DOM management.
 *
 * The same handle is keyboard-operable (ArrowUp / ArrowDown move it by one), so
 * reordering works without a pointer — the accessible fallback to dragging.
 *
 * Used by every reorderable surface in the app (the Notes index, study blocks,
 * the template lists) so the affordance and feel are identical everywhere.
 */

/** Pixels the pointer must travel before a press becomes a drag (vs. a click). */
const DRAG_THRESHOLD = 4;

export interface ReorderHandleOptions {
  /** The grab element; receives the pointer + keyboard listeners. */
  handle: HTMLElement;
  /** The row element this handle reorders (for the drag visual + measuring). */
  getItem: () => HTMLElement | null;
  /** The reorderable sibling rows, in current visual/document order. */
  getSiblings: () => HTMLElement[];
  /** Commit a move: the item at index `from` should end up at index `to`. */
  onReorder: (from: number, to: number) => void;
}

/** Move the element at `from` to index `to`, returning a new array. */
export function arrayMove<T>(
  items: readonly T[],
  from: number,
  to: number,
): T[] {
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) {
    next.splice(to, 0, moved);
  }
  return next;
}

/** The insertion gap (0…n) the pointer is over, by row midpoints. */
function gapAtPointer(siblings: HTMLElement[], y: number): number {
  for (let i = 0; i < siblings.length; i++) {
    const rect = siblings[i]?.getBoundingClientRect();
    if (rect && y < rect.top + rect.height / 2) {
      return i;
    }
  }
  return siblings.length;
}

/** Turn an insertion gap into an array-move target index (post-removal). */
function gapToTarget(from: number, gap: number): number {
  return gap > from ? gap - 1 : gap;
}

function createIndicator(): HTMLElement {
  const el = document.createElement("div");
  el.className = "reorder-drop-indicator";
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  return el;
}

/** Lay the indicator across the gap, in viewport coords (it is `position:fixed`). */
function positionIndicator(
  indicator: HTMLElement,
  siblings: HTMLElement[],
  gap: number,
): void {
  const anchor =
    gap < siblings.length ? siblings[gap] : siblings[siblings.length - 1];
  if (!anchor) {
    return;
  }
  const rect = anchor.getBoundingClientRect();
  const top = gap < siblings.length ? rect.top : rect.bottom;
  indicator.style.left = `${String(rect.left)}px`;
  indicator.style.width = `${String(rect.width)}px`;
  indicator.style.top = `${String(top)}px`;
}

/**
 * Wire a drag handle. Returns a cleanup function that detaches every listener
 * and tears down any in-flight drag.
 */
export function attachReorderHandle(options: ReorderHandleOptions): () => void {
  const { handle, getItem, getSiblings, onReorder } = options;

  let armed = false;
  let dragging = false;
  let fromIndex = -1;
  let startX = 0;
  let startY = 0;
  let item: HTMLElement | null = null;
  let indicator: HTMLElement | null = null;

  const clearVisual = (): void => {
    if (indicator) {
      indicator.remove();
      indicator = null;
    }
    if (item) {
      item.style.opacity = "";
      item.classList.remove("reorder-dragging");
    }
    document.body.classList.remove("reorder-active");
  };

  const teardown = (): void => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    document.removeEventListener("keydown", onEscape, true);
  };

  /** Suppress the click that follows a drag so it doesn't also fire (e.g. a menu). */
  const suppressNextClick = (): void => {
    const suppressor = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    handle.addEventListener("click", suppressor, { capture: true, once: true });
    window.setTimeout(() => {
      handle.removeEventListener("click", suppressor, { capture: true });
    }, 0);
  };

  function onPointerMove(event: PointerEvent): void {
    if (!armed || !item) {
      return;
    }
    if (!dragging) {
      if (
        Math.hypot(event.clientX - startX, event.clientY - startY) <
        DRAG_THRESHOLD
      ) {
        return;
      }
      dragging = true;
      item.style.opacity = "0.5";
      item.classList.add("reorder-dragging");
      document.body.classList.add("reorder-active");
    }
    event.preventDefault();
    const siblings = getSiblings();
    indicator ??= createIndicator();
    positionIndicator(
      indicator,
      siblings,
      gapAtPointer(siblings, event.clientY),
    );
  }

  function onPointerUp(event: PointerEvent): void {
    const wasDragging = dragging;
    let target = -1;
    if (wasDragging) {
      const siblings = getSiblings();
      target = gapToTarget(fromIndex, gapAtPointer(siblings, event.clientY));
    }
    teardown();
    clearVisual();
    armed = false;
    dragging = false;
    const from = fromIndex;
    fromIndex = -1;
    item = null;
    if (wasDragging) {
      suppressNextClick();
      if (target >= 0 && target !== from) {
        onReorder(from, target);
      }
    }
  }

  function onPointerCancel(): void {
    teardown();
    clearVisual();
    armed = false;
    dragging = false;
    fromIndex = -1;
    item = null;
  }

  function onEscape(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onPointerCancel();
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    const current = getItem();
    if (!current) {
      return;
    }
    const index = getSiblings().indexOf(current);
    if (index < 0) {
      return;
    }
    item = current;
    fromIndex = index;
    armed = true;
    dragging = false;
    startX = event.clientX;
    startY = event.clientY;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    document.addEventListener("keydown", onEscape, true);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }
    const current = getItem();
    if (!current) {
      return;
    }
    const siblings = getSiblings();
    const index = siblings.indexOf(current);
    if (index < 0) {
      return;
    }
    const target = event.key === "ArrowUp" ? index - 1 : index + 1;
    if (target < 0 || target >= siblings.length) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onReorder(index, target);
  }

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("keydown", onKeyDown);

  return () => {
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.removeEventListener("keydown", onKeyDown);
    onPointerCancel();
  };
}
