"use client";

import { gapCursor } from "prosemirror-gapcursor";
import { history } from "prosemirror-history";
import { X } from "lucide-react";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useEditorContext } from "@/components/studies/editor-context";
import { DEFAULT_EDITOR_TOOLS } from "@/lib/editor/editor-tools";
import { placeNearAnchor } from "@/lib/editor/floating-position";
import { setNoteSticky } from "@/lib/editor/note-highlight";
import { buildNodeViews } from "@/lib/editor/node-views";
import { buildInputRules } from "@/lib/editor/plugins/input-rules";
import { buildKeymaps } from "@/lib/editor/plugins/keymap";
import { linkClickPlugin } from "@/lib/editor/plugins/link-click";
import { linkPastePlugin } from "@/lib/editor/plugins/link-paste";
import { linkPreviewPlugin } from "@/lib/editor/plugins/link-preview";
import {
  NOTE_OPEN_EVENT,
  type NoteOpenEventDetail,
} from "@/lib/editor/plugins/note-anchors";
import {
  flashNoteEntry,
  focusNoteEntryBody,
} from "@/lib/editor/plugins/notes-index-view";
import { schema } from "@/lib/editor/schema";
import { UNDO_GROUP_DELAY_MS, withUndoBoundary } from "@/lib/editor/word-undo";

const WIDTH = 360;
/** Estimated popover height for the initial placement — we re-clamp at paint. */
const ESTIMATED_HEIGHT = 220;
/** Debounce window before writing popover edits back into the blocks doc. */
const WRITEBACK_MS = 200;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Floating, draggable popover for editing one shared note. Listens for the
 * {@link NOTE_OPEN_EVENT} window event (fired by `createNote` and by the inline
 * note-icon click handler) and either focuses the inline notes-index row OR
 * opens the popover, per the visibility rule:
 *
 *   - If the study-blocks doc is detached AND the visible tab in its dockview
 *     group, the inline row IS the editing surface — focus its caret + flash.
 *   - Otherwise (blocks inline above the body, blocks in a background dock tab,
 *     or no dockview at all), render the popover via `createPortal(document.body)`
 *     so it ALWAYS escapes any hidden ancestor. Inside the popover lives a
 *     small ProseMirror editor seeded from the note's `note_entry` body; edits
 *     two-way-sync with that entry (debounced writeback on input, inbound
 *     reconciliation only while unfocused so the caret never jumps).
 *
 * No inline toolbar — the mini editor registers itself with `EditorContext` as
 * a "dialog" role on focus, so the main study toolbar drives formatting. Owners
 * only — rendered next to the rest of the workspace in `study-workspace.tsx`.
 */
export function NotePopover() {
  const ctx = useEditorContext();
  const findNoteEntry = ctx?.findNoteEntry;
  const getBlocksView = ctx?.getBlocksView;
  const isDockBlocksVisible = ctx?.isDockBlocksVisible;
  const registerView = ctx?.registerView;
  const unregisterView = ctx?.unregisterView;
  const setActive = ctx?.setActive;
  const activeState = ctx?.activeState ?? null;
  const editorTools = ctx?.editorTools ?? DEFAULT_EDITOR_TOOLS;

  const [openId, setOpenId] = useState<string | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const mountRef = useRef<HTMLDivElement | null>(null);
  const miniRef = useRef<EditorView | null>(null);

  // Open on the window event. Both entry points (`createNote` + inline
  // icon click) route through here so the visibility rule lives in one
  // place. When the inline row is the active editing surface (detached +
  // visible tab), focus + flash it and skip the popover entirely.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<NoteOpenEventDetail>).detail;
      if (isDockBlocksVisible?.() && findNoteEntry && getBlocksView) {
        const hit = findNoteEntry(detail.id);
        const blocksView = getBlocksView();
        if (hit && blocksView) {
          focusNoteEntryBody(blocksView, hit.pos);
          flashNoteEntry(blocksView, hit.pos);
          return;
        }
        // Fall through to the popover if the entry can't be located — should
        // be impossible for a freshly-created note, but harmless as a fallback.
      }
      const anchor = detail.anchorRect;
      if (anchor) {
        const placement = placeNearAnchor(
          anchor,
          { width: WIDTH, height: ESTIMATED_HEIGHT },
          { preferred: "below", align: "start", gap: 8 },
        );
        setPos({ x: placement.left, y: placement.top });
      } else {
        setPos({
          x: Math.max(16, window.innerWidth - WIDTH - 32),
          y: 96,
        });
      }
      setOpenId(detail.id);
    };
    window.addEventListener(NOTE_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(NOTE_OPEN_EVENT, onOpen);
    };
  }, [findNoteEntry, getBlocksView, isDockBlocksVisible]);

  // Build the mini editor when a note opens; tear it down on close / id change.
  // Two-way sync with the inline note_entry: edits in the popover flow back via
  // a 200ms-debounced replace, and edits in the inline row reconcile here (see
  // the next effect) — but only while the mini editor is unfocused, so the
  // caret never jumps under the user.
  useEffect(() => {
    if (openId == null || !findNoteEntry || !getBlocksView) {
      return;
    }
    const mount = mountRef.current;
    const hit = findNoteEntry(openId);
    if (!mount || !hit) {
      return;
    }

    let writeTimer: ReturnType<typeof setTimeout> | null = null;
    const writeBack = () => {
      const blocksView = getBlocksView();
      const view = miniRef.current;
      if (!blocksView || !view) {
        return;
      }
      const current = findNoteEntry(openId);
      if (!current) {
        return;
      }
      const next = view.state.doc.content;
      if (current.node.content.eq(next)) {
        return;
      }
      const tr = blocksView.state.tr.replaceWith(
        current.pos + 1,
        current.pos + 1 + current.node.content.size,
        next,
      );
      tr.setMeta("allowVerseEdit", true);
      blocksView.dispatch(tr);
    };

    const view = new EditorView(mount, {
      state: EditorState.create({
        doc: schema.topNodeType.create(null, hit.node.content),
        plugins: [
          buildInputRules(editorTools),
          ...buildKeymaps(editorTools),
          gapCursor(),
          history({ newGroupDelay: UNDO_GROUP_DELAY_MS }),
          linkPastePlugin(),
          linkClickPlugin(),
          linkPreviewPlugin(),
        ],
      }),
      nodeViews: buildNodeViews(true),
      dispatchTransaction(transaction) {
        const v = miniRef.current;
        if (!v) {
          return;
        }
        const next = v.state.apply(withUndoBoundary(v, transaction));
        v.updateState(next);
        // Mirror what the main editors do (document-editor.tsx) — every
        // dispatch makes this view the toolbar's active target and refreshes
        // its active-mark states. Without this, the toolbar would freeze on
        // the state captured at focus time.
        setActive?.(v, next);
        if (transaction.docChanged) {
          if (writeTimer) {
            clearTimeout(writeTimer);
          }
          writeTimer = setTimeout(writeBack, WRITEBACK_MS);
        }
      },
      handleDOMEvents: {
        focus: () => {
          const v = miniRef.current;
          if (v) {
            setActive?.(v, v.state);
          }
          return false;
        },
      },
    });
    miniRef.current = view;
    // Register as a "dialog" role: the main toolbar reuses the dialog gating
    // (hides Note/Scripture, keeps formatting commands wired) and the popover
    // doesn't override the section's notes / blocks view refs.
    registerView?.(view, "dialog");
    view.focus();
    setActive?.(view, view.state);
    // Keep the note's anchored region lit while the popover is open. The
    // verse-ref pill's `jumpToNoteRef` only clears its 800ms sticky when the
    // sticky id still matches the same note — so this open lifetime takes
    // precedence and the highlight stays on for the whole session.
    setNoteSticky(openId);

    return () => {
      if (writeTimer) {
        clearTimeout(writeTimer);
      }
      // Flush the last edit on close so a quick edit-then-close doesn't
      // lose the trailing characters that landed inside the debounce window.
      writeBack();
      setNoteSticky(null);
      unregisterView?.(view);
      view.destroy();
      miniRef.current = null;
    };
  }, [
    openId,
    findNoteEntry,
    getBlocksView,
    editorTools,
    registerView,
    unregisterView,
    setActive,
  ]);

  // Inbound sync: when the blocks doc changes (the inline notes-index row was
  // edited, or a co-editor's change arrived), refresh the mini editor — but
  // only while it's unfocused, and only if the content actually differs. This
  // preserves the caret while the user is typing and avoids an echo loop with
  // the writeback effect above.
  useEffect(() => {
    if (openId == null || !findNoteEntry) {
      return;
    }
    const view = miniRef.current;
    if (!view || view.hasFocus()) {
      return;
    }
    const hit = findNoteEntry(openId);
    if (!hit) {
      return;
    }
    if (!hit.node.content.eq(view.state.doc.content)) {
      view.dispatch(
        view.state.tr.replaceWith(
          0,
          view.state.doc.content.size,
          hit.node.content,
        ),
      );
    }
  }, [activeState, openId, findNoteEntry]);

  // Escape closes.
  useEffect(() => {
    if (openId == null) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenId(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [openId]);

  if (!ctx || openId == null) {
    return null;
  }

  const onHeaderPointerDown = (event: ReactPointerEvent) => {
    if (event.target instanceof HTMLElement && event.target.closest("button")) {
      return; // don't start a drag from the close button
    }
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...pos };
    const onMove = (move: PointerEvent) => {
      setPos({
        x: clamp(
          origin.x + move.clientX - startX,
          8,
          window.innerWidth - WIDTH - 8,
        ),
        y: clamp(origin.y + move.clientY - startY, 8, window.innerHeight - 80),
      });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  return createPortal(
    <div
      className="fixed z-50 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
      style={{ left: pos.x, top: pos.y, width: WIDTH }}
      role="dialog"
      aria-label="Note"
    >
      <div
        className="flex cursor-move items-center justify-between gap-2 bg-muted px-3 py-2 select-none"
        data-drag-handle="true"
        onPointerDown={onHeaderPointerDown}
      >
        <span className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
          Note
        </span>
        <button
          type="button"
          aria-label="Close note"
          className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground"
          onClick={(event) => {
            event.preventDefault();
            setOpenId(null);
          }}
        >
          <X className="size-4" />
        </button>
      </div>
      <div
        ref={mountRef}
        className="max-h-80 overflow-y-auto px-3 py-2 text-body"
      />
    </div>,
    document.body,
  );
}
