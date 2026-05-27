"use client";

import { Slice } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
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
import { scriptureParagraphsToNodes } from "@/lib/editor/scripture-insert";
import { jsonToDoc } from "@/lib/editor/serialize";
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

export type EditorRole = "notes" | "blocks";

export interface ScriptureInsertResult {
  ok: boolean;
  error?: string;
}

interface EditorContextValue {
  /** The editor the shared toolbar acts on (the last one focused/edited). */
  activeView: EditorView | null;
  /** That editor's latest state, for the toolbar's active/disabled states. */
  activeState: EditorState | null;
  registerView: (view: EditorView, role: EditorRole) => void;
  unregisterView: (view: EditorView) => void;
  setActive: (view: EditorView, state: EditorState) => void;
  runCommand: (command: Command) => void;
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
  const activeViewRef = useRef<EditorView | null>(null);
  const notesViewRef = useRef<EditorView | null>(null);
  const viewsRef = useRef<Set<EditorView>>(new Set());

  const adoptActive = useCallback(
    (view: EditorView | null, state: EditorState | null) => {
      activeViewRef.current = view;
      setActiveView(view);
      setActiveState(state);
    },
    [],
  );

  const registerView = useCallback(
    (view: EditorView, role: EditorRole) => {
      viewsRef.current.add(view);
      if (role === "notes") {
        notesViewRef.current = view;
      }
      if (activeViewRef.current === null) {
        adoptActive(view, view.state);
      }
    },
    [adoptActive],
  );

  const unregisterView = useCallback(
    (view: EditorView) => {
      viewsRef.current.delete(view);
      if (notesViewRef.current === view) {
        notesViewRef.current = null;
      }
      if (activeViewRef.current === view) {
        const next = viewsRef.current.values().next().value ?? null;
        adoptActive(next, next ? next.state : null);
      }
    },
    [adoptActive],
  );

  const setActive = useCallback(
    (view: EditorView, state: EditorState) => {
      adoptActive(view, state);
    },
    [adoptActive],
  );

  const runCommand = useCallback((command: Command) => {
    const view = activeViewRef.current;
    if (!view) {
      return;
    }
    command(view.state, view.dispatch, view);
    view.focus();
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
      registerView,
      unregisterView,
      setActive,
      runCommand,
      insertScripture,
      scriptureOptions: initialScriptureOptions,
      editorTools: initialEditorTools,
      prefillReference,
      formatRecents,
      runFormatAction,
    }),
    [
      activeView,
      activeState,
      registerView,
      unregisterView,
      setActive,
      runCommand,
      insertScripture,
      initialScriptureOptions,
      initialEditorTools,
      prefillReference,
      formatRecents,
      runFormatAction,
    ],
  );

  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  );
}
