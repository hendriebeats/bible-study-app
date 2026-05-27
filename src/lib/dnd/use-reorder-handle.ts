"use client";

import { useCallback, useEffect, useRef } from "react";

import { attachReorderHandle } from "@/lib/dnd/pointer-reorder";

/**
 * React adapter for {@link attachReorderHandle}. Returns a ref callback to put
 * on the drag handle element. The handle finds its own row via the nearest
 * `[data-reorder-item]` ancestor and its siblings via the enclosing
 * `[data-reorder-group]` container, so callers only mark up the list and supply
 * `onReorder(from, to)` (array-move indices into the rendered order).
 */
export function useReorderHandle(
  onReorder: (from: number, to: number) => void,
): (element: HTMLElement | null) => void {
  const onReorderRef = useRef(onReorder);
  useEffect(() => {
    onReorderRef.current = onReorder;
  });

  const handleRef = useRef<HTMLElement | null>(null);
  const detachRef = useRef<(() => void) | null>(null);

  const attach = useCallback((element: HTMLElement | null) => {
    detachRef.current?.();
    detachRef.current = null;
    handleRef.current = element;
    if (!element) {
      return;
    }
    detachRef.current = attachReorderHandle({
      handle: element,
      getItem: () => element.closest<HTMLElement>("[data-reorder-item]"),
      getSiblings: () => {
        const group = element.closest<HTMLElement>("[data-reorder-group]");
        return group
          ? Array.from(
              group.querySelectorAll<HTMLElement>("[data-reorder-item]"),
            )
          : [];
      },
      onReorder: (from, to) => {
        onReorderRef.current(from, to);
      },
    });
  }, []);

  useEffect(() => {
    return () => {
      detachRef.current?.();
      detachRef.current = null;
    };
  }, []);

  return attach;
}
