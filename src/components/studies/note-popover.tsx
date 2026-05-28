"use client";

import { gapCursor } from "prosemirror-gapcursor";
import { history } from "prosemirror-history";
import { Bold, Italic, List, X } from "lucide-react";
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
import {
  toggleBold,
  toggleBulletList,
  toggleItalic,
} from "@/lib/editor/commands";
import { buildNodeViews } from "@/lib/editor/node-views";
import { buildInputRules } from "@/lib/editor/plugins/input-rules";
import { buildKeymaps } from "@/lib/editor/plugins/keymap";
import {
  NOTE_OPEN_EVENT,
  type NoteOpenEventDetail,
} from "@/lib/editor/plugins/note-anchors";
import { setNoteSticky } from "@/lib/editor/note-highlight";
import { schema } from "@/lib/editor/schema";
import { UNDO_GROUP_DELAY_MS, withUndoBoundary } from "@/lib/editor/word-undo";

const WIDTH = 360;
/** Debounce before writing popover edits back into the blocks doc. */
const WRITEBACK_MS = 200;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * A fixed-position, draggable popover for editing one shared note. Opens on the
 * {@link NOTE_OPEN_EVENT} window event (fired by `createNote` and by clicking an
 * inline note icon). It hosts its own mini ProseMirror editor seeded from the
 * note's body (which lives in the `note_entry` in the blocks doc). Edits are
 * two-way synced with that entry: the popover writes back on input (debounced),
 * and edits made directly in the index row flow back here (reconciled only while
 * the mini editor is unfocused, so the caret never jumps). Owners only — rendered
 * inside the editor provider in section-surface.
 */
export function NotePopover() {
  const ctx = useEditorContext();
  // These are stable useCallbacks on the context, safe as effect deps.
  const findNoteEntry = ctx?.findNoteEntry;
  const getBlocksView = ctx?.getBlocksView;
  const activeState = ctx?.activeState ?? null;

  const [openId, setOpenId] = useState<string | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const mountRef = useRef<HTMLDivElement | null>(null);
  const miniRef = useRef<EditorView | null>(null);

  // Open on the window event; park the popover near the top-right, clamped.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<NoteOpenEventDetail>).detail;
      setPos({
        x: Math.max(16, window.innerWidth - WIDTH - 32),
        y: 96,
      });
      setOpenId(detail.id);
    };
    window.addEventListener(NOTE_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(NOTE_OPEN_EVENT, onOpen);
    };
  }, []);

  // Build the mini editor when a note opens; tear it down on close / id change.
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
          buildInputRules(),
          ...buildKeymaps(),
          gapCursor(),
          history({ newGroupDelay: UNDO_GROUP_DELAY_MS }),
        ],
      }),
      nodeViews: buildNodeViews(true),
      dispatchTransaction(transaction) {
        const v = miniRef.current;
        if (!v) {
          return;
        }
        v.updateState(v.state.apply(withUndoBoundary(v, transaction)));
        if (transaction.docChanged) {
          if (writeTimer) {
            clearTimeout(writeTimer);
          }
          writeTimer = setTimeout(writeBack, WRITEBACK_MS);
        }
      },
    });
    miniRef.current = view;
    view.focus();
    // Keep the note's anchored region lit while the popover is open.
    setNoteSticky(openId);

    return () => {
      if (writeTimer) {
        clearTimeout(writeTimer);
      }
      writeBack(); // flush the last edit on close
      setNoteSticky(null);
      view.destroy();
      miniRef.current = null;
    };
  }, [openId, findNoteEntry, getBlocksView]);

  // Inbound sync: when the blocks doc changes (index row edited, cross-tab),
  // refresh the mini editor — but only while it's unfocused, and only if the
  // content actually differs, so the caret never jumps and there's no echo.
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

  const runMini = (command: typeof toggleBold) => {
    const view = miniRef.current;
    if (!view) {
      return;
    }
    command(view.state, view.dispatch, view);
    view.focus();
  };

  const toolBtn =
    "flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground";

  return createPortal(
    <div
      className="fixed z-50 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
      style={{ left: pos.x, top: pos.y, width: WIDTH }}
      role="dialog"
      aria-label="Note"
    >
      <div
        className="flex cursor-move items-center justify-between gap-2 bg-muted px-3 py-2 select-none"
        onPointerDown={onHeaderPointerDown}
      >
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Note
        </span>
        <button
          type="button"
          data-close="true"
          aria-label="Close note"
          className="flex size-6 items-center justify-center rounded-sm hover:bg-background"
          onClick={() => {
            setOpenId(null);
          }}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex items-center gap-0.5 border-b px-2 py-1">
        <button
          type="button"
          aria-label="Bold"
          className={toolBtn}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            runMini(toggleBold);
          }}
        >
          <Bold className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Italic"
          className={toolBtn}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            runMini(toggleItalic);
          }}
        >
          <Italic className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Bullet list"
          className={toolBtn}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            runMini(toggleBulletList);
          }}
        >
          <List className="size-4" />
        </button>
      </div>
      <div
        ref={mountRef}
        className="max-h-80 overflow-y-auto px-3 py-2 text-sm"
      />
    </div>,
    document.body,
  );
}
