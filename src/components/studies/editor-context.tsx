"use client";

import { type Node, Slice } from "prosemirror-model";
import {
  type Command,
  type EditorState,
  TextSelection,
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { saveFormatRecents } from "@/app/account/actions";
import { addScripturePassage } from "@/app/studies/actions";
import {
  setHighlight,
  setTextColor,
  toggleBold,
  toggleItalic,
  toggleStrike,
} from "@/lib/editor/commands";
import { type EditorTools } from "@/lib/editor/editor-tools";
import {
  type FormatAction,
  type FormatRecents,
  pushRecent,
} from "@/lib/editor/format-actions";
import {
  NOTE_OPEN_EVENT,
  type NoteOpenEventDetail,
} from "@/lib/editor/plugins/note-anchors";
import { marks, nodes, type VerseNumberAttrs } from "@/lib/editor/schema";
import { sectionUndo } from "@/lib/editor/section-undo";
import { scriptureParagraphsToNodes } from "@/lib/editor/scripture-insert";
import { jsonToDoc } from "@/lib/editor/serialize";
import type { PMDocJSON } from "@/lib/editor/types";
import type { ScriptureOptions } from "@/lib/scripture/options";
import { parseReference } from "@/lib/scripture/reference";

/** Map a recents entry to the ProseMirror command that performs it. */
function commandForAction(action: FormatAction): Command {
  switch (action.type) {
    case "highlight":
      return setHighlight(action.color);
    case "textColor":
      return setTextColor(action.color);
    case "bold":
      return toggleBold;
    case "italic":
      return toggleItalic;
    case "strike":
      return toggleStrike;
  }
}

/** Debounce window before persisting recents to the user's account. */
const RECENTS_SAVE_DELAY_MS = 800;

/**
 * The reference of the verse the position `pos` falls under: the last
 * `verse_number` marker at or before it (text after a marker belongs to that
 * verse). Returns `chapter:verse` (or the marker's printed `n`), or "" when no
 * verse precedes the position — i.e. the noted region isn't near a verse.
 */
function nearestVerseRef(doc: Node, pos: number): string {
  let ref = "";
  doc.nodesBetween(0, pos, (node) => {
    if (node.type === nodes.verseNumber) {
      const attrs = node.attrs as VerseNumberAttrs;
      if (attrs.chapter != null && attrs.verse != null) {
        ref = `${String(attrs.chapter)}:${String(attrs.verse)}`;
      } else if (attrs.n !== "") {
        ref = attrs.n;
      }
    }
    return true;
  });
  return ref;
}

export type EditorRole = "notes" | "blocks" | "dialog";

export interface ScriptureInsertResult {
  ok: boolean;
  error?: string;
}

export interface NoteCreateResult {
  ok: boolean;
  error?: string;
  /** The new note's id (present when ok) — used to open its popover. */
  id?: string;
}

/** A located note body in the blocks doc: the entry node + its absolute pos. */
export interface NoteEntryHit {
  pos: number;
  node: Node;
}

interface EditorContextValue {
  /** The editor the shared toolbar acts on (the last one focused/edited). */
  activeView: EditorView | null;
  /** That editor's latest state, for the toolbar's active/disabled states. */
  activeState: EditorState | null;
  /** Which kind of editor is currently active — lets the toolbar/bubble hide
   * doc-specific buttons (Note, Scripture) when a dialog body is focused. */
  activeKind: EditorRole | null;
  registerView: (view: EditorView, role: EditorRole) => void;
  unregisterView: (view: EditorView) => void;
  setActive: (view: EditorView, state: EditorState) => void;
  /**
   * Drop the toolbar's "active KIND" pointer (only) without unregistering
   * anything or nulling the view/state. Called from non-editor focus targets
   * inside a dialog (a block card's title textarea, the per-card ⋮ menu, …)
   * so the dialog toolbar disables itself while the user is on a surface
   * that doesn't accept formatting. Critically, `activeView` and
   * `activeState` stay set — the studies-page skeleton ([[studies-loading-
   * skeleton]]) gates on those, and nulling them would flip the page back
   * to its cold-load skeleton mid-edit. The next editor `focus`/dispatch
   * re-asserts the kind via {@link setActive}. Idempotent.
   */
  clearActive: () => void;
  runCommand: (command: Command) => void;
  /**
   * Anchor a shared note on the active editor's selection: marks the selected
   * text and adds an (empty) note body to the pinned notes index in the blocks
   * doc, focused for typing. Returns an error when there's no usable selection.
   */
  createNote: () => NoteCreateResult;
  /** The Study-blocks editor view (which hosts the notes index), or null. */
  getBlocksView: () => EditorView | null;
  /** Locate a note's body entry in the blocks doc by id (null if not found). */
  findNoteEntry: (id: string) => NoteEntryHit | null;
  /**
   * Restore both of the section's documents to past states in one action (the
   * shared version history). Each non-null target replaces that editor's whole
   * content; flows through the normal persist/broadcast/undo path.
   */
  restoreSection: (
    notesDoc: PMDocJSON | null,
    blocksDoc: PMDocJSON | null,
  ) => void;
  /** Insert an ESV passage as editable paragraphs into the notes editor. */
  insertScripture: (
    reference: string,
    options: ScriptureOptions,
  ) => Promise<ScriptureInsertResult>;
  /** The user's remembered scripture-insertion defaults. */
  scriptureOptions: ScriptureOptions;
  /** The user's enabled opt-in editor tools (gates toolbar / slash-menu items). */
  editorTools: EditorTools;
  /** The section title when it's itself a valid reference, else "" (for prefill). */
  prefillReference: string;
  /** Recently-used formatting actions (most-recent first) for the bubble's quick action. */
  formatRecents: FormatAction[];
  /** Run a formatting action on the active editor AND bump it to the front of recents. */
  runFormatAction: (action: FormatAction) => void;
  /**
   * Scripture-insert panel open state, hoisted out of the toolbar so other
   * surfaces — the empty-owner Study Body overlay, future deep links — can
   * open the same panel without owning a duplicate copy.
   */
  scriptureOpen: boolean;
  setScriptureOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  /**
   * Register a probe that returns true when the study-blocks doc is detached
   * into its own dockview tab AND that tab is the active (visible) panel in
   * its group. Read by {@link isDockBlocksVisible}; surfaces from
   * `StudyDockview` so this provider doesn't depend on dockview internals.
   * Pass `null` to unregister.
   */
  setDockBlocksVisibilityProbe: (probe: (() => boolean) | null) => void;
  /**
   * True when the study-blocks doc is detached AND the visible tab in its
   * group. `createNote` and the note-icon-click handler (in `NotePopover`)
   * use it to decide whether to focus the entry inline or pop the floating
   * note editor.
   */
  isDockBlocksVisible: () => boolean;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditorContext(): EditorContextValue | null {
  return useContext(EditorContext);
}

/**
 * Coordinates a section's two editors (notes + study blocks) so a single sticky
 * toolbar can format whichever one is focused. Each `DocumentEditor` registers
 * its view and reports focus/state here; the toolbar dispatches commands to the
 * active view and routes "Add scripture" to the notes view.
 */
export function EditorProvider({
  sectionId,
  sectionTitle,
  initialScriptureOptions,
  initialFormatRecents,
  initialEditorTools,
  children,
}: {
  sectionId: string;
  sectionTitle: string;
  initialScriptureOptions: ScriptureOptions;
  initialFormatRecents: FormatRecents;
  initialEditorTools: EditorTools;
  children: ReactNode;
}) {
  const [activeView, setActiveView] = useState<EditorView | null>(null);
  const [activeState, setActiveState] = useState<EditorState | null>(null);
  const [activeKind, setActiveKind] = useState<EditorRole | null>(null);
  const [scriptureOpen, setScriptureOpenState] = useState(false);
  const activeViewRef = useRef<EditorView | null>(null);
  const notesViewRef = useRef<EditorView | null>(null);
  const blocksViewRef = useRef<EditorView | null>(null);
  const viewsRef = useRef<Set<EditorView>>(new Set());
  // Set by `StudyDockview` once its dockview API is ready; null otherwise (e.g.
  // dialog-only editor surfaces). `createNote` reads through this ref every
  // call so it always sees the freshest blocks-tab visibility.
  const dockBlocksVisibilityProbeRef = useRef<(() => boolean) | null>(null);
  // Per-view role — lets `setActive` derive the active kind without callers
  // having to pass it on every focus/edit.
  const viewKindRef = useRef<Map<EditorView, EditorRole>>(new Map());

  const adoptActive = useCallback(
    (
      view: EditorView | null,
      state: EditorState | null,
      kind: EditorRole | null,
    ) => {
      activeViewRef.current = view;
      setActiveView(view);
      setActiveState(state);
      setActiveKind(kind);
    },
    [],
  );

  const registerView = useCallback(
    (view: EditorView, role: EditorRole) => {
      viewsRef.current.add(view);
      viewKindRef.current.set(view, role);
      if (role === "notes") {
        notesViewRef.current = view;
      }
      if (role === "blocks") {
        blocksViewRef.current = view;
      }
      // "dialog" views don't override notesViewRef / blocksViewRef — those keep
      // pointing at the underlying section's real editors (createNote/scripture
      // still target the right doc).
      if (activeViewRef.current === null) {
        adoptActive(view, view.state, role);
      }
    },
    [adoptActive],
  );

  const unregisterView = useCallback(
    (view: EditorView) => {
      viewsRef.current.delete(view);
      viewKindRef.current.delete(view);
      if (notesViewRef.current === view) {
        notesViewRef.current = null;
      }
      if (blocksViewRef.current === view) {
        blocksViewRef.current = null;
      }
      if (activeViewRef.current === view) {
        const next = viewsRef.current.values().next().value ?? null;
        if (next) {
          adoptActive(next, next.state, viewKindRef.current.get(next) ?? null);
        } else {
          // Intentionally KEEP the previous `activeState` (visual snapshot) so
          // the toolbar's enabled/active states don't flash on every section
          // navigation — the old editors unregister before the new ones
          // register, and a transient null `activeState` made the toolbar
          // briefly darken (disabled). We null the view + kind so `runCommand`
          // safely no-ops if anyone tries to dispatch during the gap. The
          // next `registerView` will overwrite `activeState` cleanly.
          activeViewRef.current = null;
          setActiveView(null);
          setActiveKind(null);
        }
      }
    },
    [adoptActive],
  );

  const setActive = useCallback(
    (view: EditorView, state: EditorState) => {
      adoptActive(view, state, viewKindRef.current.get(view) ?? null);
    },
    [adoptActive],
  );

  const clearActive = useCallback(() => {
    // Only the KIND is cleared. The dialog toolbar's disabled formula is
    // `scope === "dialog" && activeKind !== "dialog"`, so nulling the kind
    // alone disables it. View + state stay set so the studies-page skeleton
    // (which gates on activeView/activeState being non-null) doesn't flip
    // back to its cold-load state when the user clicks a header/subtitle.
    setActiveKind((prev) => (prev === null ? prev : null));
  }, []);

  const runCommand = useCallback((command: Command) => {
    const view = activeViewRef.current;
    if (!view) {
      return;
    }
    command(view.state, view.dispatch, view);
    view.focus();
  }, []);

  const createNote = useCallback((): NoteCreateResult => {
    const view = activeViewRef.current;
    if (!view) {
      return { ok: false, error: "Select some text to add a note." };
    }
    const { from, to, empty } = view.state.selection;
    if (empty || to <= from) {
      return { ok: false, error: "Select some text to add a note." };
    }
    const id = crypto.randomUUID();
    const source = view === notesViewRef.current ? "notes" : "blocks";

    // 1. Anchor the note on the selected text, then collapse to its end so the
    //    selection bubble dismisses and the inline icon shows.
    const anchorTr = view.state.tr.addMark(from, to, marks.note.create({ id }));
    anchorTr.setSelection(TextSelection.create(anchorTr.doc, to));
    view.dispatch(anchorTr);

    // 2. Add the (empty) note body to the pinned index in the blocks doc,
    //    lazily creating the index when this is the section's first note. If the
    //    blocks doc is still just a lone empty paragraph, replace it so the index
    //    sits flush atop the blocks stack rather than below a stray blank line.
    const blocksView = blocksViewRef.current ?? view;
    const verseRef = nearestVerseRef(view.state.doc, from);
    const entry = nodes.noteEntry.createAndFill({ id, source, verseRef });
    if (!entry) {
      return { ok: false, error: "Couldn't create the note." };
    }
    const doc = blocksView.state.doc;
    const tr = blocksView.state.tr;
    if (doc.firstChild?.type === nodes.notesIndex) {
      // Append the entry to the existing index's content.
      tr.insert(1 + doc.firstChild.content.size, entry);
    } else {
      const index = nodes.notesIndex.create(null, entry);
      const onlyChild = doc.firstChild;
      const isLonePlaceholder =
        doc.childCount === 1 &&
        onlyChild?.type === nodes.paragraph &&
        onlyChild.content.size === 0;
      if (isLonePlaceholder) {
        tr.replaceWith(0, doc.content.size, index);
      } else {
        tr.insert(0, index);
      }
    }
    tr.setMeta("allowVerseEdit", true);
    blocksView.dispatch(tr);

    // Always dispatch the open event with the source caret's screen rect. The
    // popover's handler decides what to do with it — when the blocks doc is
    // detached AND visible, it focuses the new entry inline instead of opening
    // the popup (same branch the inline note-icon click goes through). Routing
    // both paths through one event keeps the "where does my note land" rule
    // in one place.
    let anchorRect: NoteOpenEventDetail["anchorRect"];
    try {
      const r = view.coordsAtPos(view.state.selection.to);
      anchorRect = {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      };
    } catch {
      anchorRect = undefined;
    }
    window.dispatchEvent(
      new CustomEvent<NoteOpenEventDetail>(NOTE_OPEN_EVENT, {
        detail: { id, anchorRect },
      }),
    );
    return { ok: true, id };
  }, []);

  const setScriptureOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setScriptureOpenState((prev) =>
        typeof next === "function" ? next(prev) : next,
      );
    },
    [],
  );

  const setDockBlocksVisibilityProbe = useCallback(
    (probe: (() => boolean) | null) => {
      dockBlocksVisibilityProbeRef.current = probe;
    },
    [],
  );

  const isDockBlocksVisible = useCallback(
    () => dockBlocksVisibilityProbeRef.current?.() ?? false,
    [],
  );

  const getBlocksView = useCallback(() => blocksViewRef.current, []);

  const restoreSection = useCallback(
    (notesDoc: PMDocJSON | null, blocksDoc: PMDocJSON | null) => {
      const restore = (view: EditorView | null, target: PMDocJSON | null) => {
        if (!view || !target) {
          return false;
        }
        const node = jsonToDoc(target);
        const tr = view.state.tr.replaceWith(
          0,
          view.state.doc.content.size,
          node.content,
        );
        tr.setMeta("allowVerseEdit", true);
        if (!tr.docChanged) {
          return false; // a doc with no change at that moment is left untouched
        }
        view.dispatch(tr);
        return true;
      };
      let changed = 0;
      if (restore(notesViewRef.current, notesDoc)) changed++;
      if (restore(blocksViewRef.current, blocksDoc)) changed++;
      if (changed > 0) {
        // The two docs' restores are the most recent entries on the section
        // undo stack; one Undo reverts both.
        toast.success("Section restored.", {
          action: {
            label: "Undo",
            onClick: () => {
              for (let i = 0; i < changed; i++) {
                sectionUndo();
              }
            },
          },
        });
      }
    },
    [],
  );

  const findNoteEntry = useCallback((id: string): NoteEntryHit | null => {
    const view = blocksViewRef.current;
    if (!view) {
      return null;
    }
    let hit: NoteEntryHit | null = null;
    view.state.doc.descendants((node, pos) => {
      if (hit) {
        return false;
      }
      if (node.type === nodes.noteEntry && node.attrs.id === id) {
        hit = { pos, node };
        return false;
      }
      return true;
    });
    return hit;
  }, []);

  // Recently-used formatting (the bubble's quick action). Optimistic local
  // state for instant swatch feedback; a debounced upsert persists it to the
  // account. The ref always holds the latest list so the debounced/unmount save
  // sends the freshest value regardless of React's batching.
  const [formatRecents, setFormatRecents] = useState<FormatAction[]>(
    initialFormatRecents.actions,
  );
  const recentsRef = useRef<FormatAction[]>(initialFormatRecents.actions);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runFormatAction = useCallback(
    (action: FormatAction) => {
      runCommand(commandForAction(action));
      const next = pushRecent(recentsRef.current, action);
      recentsRef.current = next;
      setFormatRecents(next);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void saveFormatRecents({ actions: recentsRef.current });
      }, RECENTS_SAVE_DELAY_MS);
    },
    [runCommand],
  );

  // Flush a pending recents save when the surface unmounts (e.g. navigating
  // sections) so the last change isn't lost.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        void saveFormatRecents({ actions: recentsRef.current });
      }
    };
  }, []);

  const insertScripture = useCallback(
    async (
      reference: string,
      options: ScriptureOptions,
    ): Promise<ScriptureInsertResult> => {
      const view = notesViewRef.current;
      if (!view) {
        return { ok: false, error: "Open the notes editor to add scripture." };
      }
      const result = await addScripturePassage(sectionId, reference, options);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      const paragraphs = scriptureParagraphsToNodes(result.text, options, {
        bookOrdinal: result.bookOrdinal,
        startChapter: result.startChapter,
      });
      if (paragraphs.length > 0) {
        const fragment = jsonToDoc({
          type: "doc",
          content: paragraphs,
        }).content;
        const tr = view.state.tr.replaceSelection(new Slice(fragment, 0, 0));
        tr.setMeta("allowVerseEdit", true);
        view.dispatch(tr);
        view.focus();
      }
      return { ok: true };
    },
    [sectionId],
  );

  // When the section title is itself a valid reference (e.g. "John 3:1-21"),
  // offer it to prefill the insert field so the user needn't retype it.
  const prefillReference = useMemo(
    () => (parseReference(sectionTitle) ? sectionTitle.trim() : ""),
    [sectionTitle],
  );

  const value = useMemo<EditorContextValue>(
    () => ({
      activeView,
      activeState,
      activeKind,
      registerView,
      unregisterView,
      setActive,
      clearActive,
      runCommand,
      createNote,
      getBlocksView,
      findNoteEntry,
      restoreSection,
      insertScripture,
      scriptureOptions: initialScriptureOptions,
      editorTools: initialEditorTools,
      prefillReference,
      formatRecents,
      runFormatAction,
      scriptureOpen,
      setScriptureOpen,
      setDockBlocksVisibilityProbe,
      isDockBlocksVisible,
    }),
    [
      activeView,
      activeState,
      activeKind,
      registerView,
      unregisterView,
      setActive,
      clearActive,
      runCommand,
      createNote,
      getBlocksView,
      findNoteEntry,
      restoreSection,
      insertScripture,
      initialScriptureOptions,
      initialEditorTools,
      prefillReference,
      formatRecents,
      runFormatAction,
      scriptureOpen,
      setScriptureOpen,
      setDockBlocksVisibilityProbe,
      isDockBlocksVisible,
    ],
  );

  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  );
}
