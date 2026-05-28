"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { gapCursor } from "prosemirror-gapcursor";
import { closeHistory, history, undo } from "prosemirror-history";
import { History, PanelRight } from "lucide-react";
import { keymap } from "prosemirror-keymap";
import type { Node } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { tableEditing } from "prosemirror-tables";
import { EditorView } from "prosemirror-view";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  appendDocumentSteps,
  createDocumentCheckpoint,
  fetchDocumentHead,
  getPreviousSectionBlockSpecs,
  getStudyTemplateBlocksDoc,
} from "@/app/studies/actions";
import { useEditorContext } from "@/components/studies/editor-context";
import { PresenceAvatars } from "@/components/studies/presence-avatars";
import { StudyBlocksDialog } from "@/components/studies/study-blocks-dialog";
import { VersionHistoryPanel } from "@/components/studies/version-history-panel";
import { Button } from "@/components/ui/button";
import type { DocumentHistory, StudyDocument } from "@/lib/db/types";
import { blocksDocFromSpecs, specsFromBlocksDoc } from "@/lib/editor/blocks";
import { makeModASelect } from "@/lib/editor/commands";
import {
  DEFAULT_EDITOR_TOOLS,
  type EditorTools,
} from "@/lib/editor/editor-tools";
import { buildNodeViews } from "@/lib/editor/node-views";
import { buildInputRules } from "@/lib/editor/plugins/input-rules";
import { buildKeymaps } from "@/lib/editor/plugins/keymap";
import { blockHandle } from "@/lib/editor/plugins/block-handle";
import { blocksSelectionGuard } from "@/lib/editor/plugins/blocks-selection-guard";
import { blocksStructureGuard } from "@/lib/editor/plugins/blocks-structure-guard";
import { noteAnchors } from "@/lib/editor/plugins/note-anchors";
import { notesIndexGuard } from "@/lib/editor/plugins/notes-index-guard";
import { placeholder as placeholderPlugin } from "@/lib/editor/plugins/placeholder";
import { slashMenu } from "@/lib/editor/plugins/slash-menu";
import { verseGuard } from "@/lib/editor/plugins/verse-guard";
import { verseLabel } from "@/lib/editor/plugins/verse-label";
import { nodes, schema } from "@/lib/editor/schema";
import {
  recordUndo,
  registerUndoView,
  sectionUndoKeymap,
  unregisterUndoView,
} from "@/lib/editor/section-undo";
import {
  docToJSON,
  jsonToDoc,
  jsonToStep,
  stepToJSON,
} from "@/lib/editor/serialize";
import type { PMDocJSON, SerializedStep } from "@/lib/editor/types";
import { UNDO_GROUP_DELAY_MS, withUndoBoundary } from "@/lib/editor/word-undo";
import {
  broadcastCursor,
  broadcastSteps,
  colorForId,
  openDocumentChannel,
} from "@/lib/realtime/document-channel";
import type { PresenceMember } from "@/lib/realtime/document-channel";

const AUTOSAVE_DELAY_MS = 1200;
/** Snapshot a checkpoint after this many new steps, to bound replay length. */
const CHECKPOINT_EVERY = 50;

type SaveStatus = "idle" | "saving" | "saved";

type EditorRole = "notes" | "blocks";

function createPlugins(
  placeholderText: string,
  role: EditorRole,
  tools: EditorTools,
) {
  const plugins = [
    // Highest priority: section-wide Cmd-Z/Cmd-Y across both editors, falling
    // through to the per-editor undo in buildKeymaps when nothing is tracked.
    sectionUndoKeymap(),
    buildInputRules(tools),
    ...buildKeymaps(tools),
    gapCursor(),
    history({ newGroupDelay: UNDO_GROUP_DELAY_MS }),
    verseGuard(),
    verseLabel(),
    slashMenu(),
    blockHandle(),
    // Cell selection + structural editing for tables (harmless when none exist).
    tableEditing(),
    // Inline clickable icon at the end of each note-anchored range.
    noteAnchors(),
    // Keep the pinned notes index from being deleted (no-op in the body editor).
    notesIndexGuard(),
    placeholderPlugin(placeholderText),
  ];
  // Progressive Mod-A: first press selects the cursor's textblock, second
  // press grows to the surrounding scope. In the freeform body editor the
  // outer scope is the whole doc; in the locked blocks editor it's the
  // enclosing study_block (so Mod-A stops at the block boundary instead of
  // wandering into the notes index or other study blocks).
  // Prepended so it beats baseKeymap's selectAll.
  plugins.unshift(
    keymap({
      "Mod-a": makeModASelect(role === "blocks" ? "study_block" : "doc"),
    }),
  );
  // The blocks doc is locked to study blocks + the pinned notes index (no
  // freeform text, no bulk-deleting blocks); the Study Body stays freeform.
  if (role === "blocks") {
    plugins.push(blocksStructureGuard(), blocksSelectionGuard());
  }
  return plugins;
}

function initialDoc(content: PMDocJSON) {
  const doc = jsonToDoc(content);
  // Defensive: the schema requires at least one block; fall back to a paragraph.
  return doc.childCount > 0 ? doc : (schema.topNodeType.createAndFill() ?? doc);
}

/** True if the blocks doc has at least one user-authored study block. */
function hasStudyBlock(doc: Node): boolean {
  for (let i = 0; i < doc.childCount; i++) {
    if (doc.child(i).type === nodes.studyBlock) {
      return true;
    }
  }
  return false;
}

/**
 * The blocks doc must always lead with the pinned `notes_index`; if a legacy /
 * empty doc lacks one, prepend a fresh node so the index always renders and the
 * editor never reverts to the freeform placeholder paragraph.
 */
function ensureNotesIndex(doc: Node): Node {
  const indexType = nodes.notesIndex;
  if (doc.firstChild?.type === indexType) {
    return doc;
  }
  const index = indexType.createAndFill();
  if (!index) {
    return doc;
  }
  // If the only child is the empty placeholder paragraph, replace it; otherwise
  // splice the index in at the front.
  const first = doc.firstChild;
  const onlyPlaceholder =
    doc.childCount === 1 &&
    first != null &&
    first.type === schema.nodes.paragraph &&
    first.content.size === 0;
  const rest = onlyPlaceholder
    ? []
    : Array.from({ length: doc.childCount }, (_, i) => doc.child(i));
  return doc.type.create(doc.attrs, [index, ...rest]);
}

function initialBlocksDoc(content: PMDocJSON): Node {
  return ensureNotesIndex(initialDoc(content));
}

/**
 * Rebuild the editor state with a usable undo stack: start from the base doc
 * (latest checkpoint) and replay the persisted steps as history-tracked
 * transactions, so Cmd-Z survives a page refresh back to that checkpoint.
 * `closeHistory` between persisted batches (different `created_at`) keeps undo
 * groups roughly at the granularity the edits were made. Any replay failure
 * falls back to the materialized head doc with no history (doc stays correct).
 */
function buildInitialState(
  bundle: DocumentHistory,
  headContent: PMDocJSON,
  placeholderText: string,
  role: EditorRole,
  tools: EditorTools,
) {
  const startDoc =
    role === "blocks"
      ? ensureNotesIndex(initialDoc(bundle.baseDoc))
      : initialDoc(bundle.baseDoc);
  try {
    let state = EditorState.create({
      doc: startDoc,
      plugins: createPlugins(placeholderText, role, tools),
    });
    let prevCreatedAt: string | null = null;
    for (const row of bundle.steps) {
      let tr = state.tr;
      if (prevCreatedAt !== null && row.created_at !== prevCreatedAt) {
        tr = closeHistory(tr);
      }
      tr.step(jsonToStep(row.step));
      // Replaying persisted history may legitimately remove verse numbers (e.g.
      // undoing a scripture insert); let it through the verse guard.
      tr.setMeta("allowVerseEdit", true);
      state = state.apply(tr);
      prevCreatedAt = row.created_at;
    }
    return state;
  } catch {
    return EditorState.create({
      doc:
        role === "blocks"
          ? ensureNotesIndex(initialDoc(headContent))
          : initialDoc(headContent),
      plugins: createPlugins(placeholderText, role, tools),
    });
  }
}

/**
 * Editable, autosaving editor for ONE document (notes or blocks) the user owns.
 * Persists ProseMirror steps via the document RPCs with optimistic concurrency,
 * broadcasts them + the cursor to read-along viewers, snapshots checkpoints,
 * and offers per-document version history. The section title lives one level up.
 */
export function DocumentEditor({
  document: doc,
  history: docHistory,
  me,
  label,
  hideLabel = false,
  hideHistory = false,
  placeholder,
  studyId,
  isTemplate = false,
  sectionPosition,
  emptyStateHasTemplate = false,
  emptyStateHasPrevious = false,
  onDetach,
}: {
  document: StudyDocument;
  history: DocumentHistory;
  me: { id: string; name: string } | null;
  label: string;
  /** Keep the label for screen readers but hide it visually (still shows the controls row). */
  hideLabel?: boolean;
  /** Hide this editor's own History button (a section-level history is used instead). */
  hideHistory?: boolean;
  placeholder: string;
  /** Set on the blocks editor to enable the study-blocks dialog. */
  studyId?: string;
  /** Template study — the blocks dialog's Template tab edits the default. */
  isTemplate?: boolean;
  /** This section's position — used by the empty-state "from previous" lookup. */
  sectionPosition?: number;
  /** Empty-state action availability (pre-computed in the section page). */
  emptyStateHasTemplate?: boolean;
  emptyStateHasPrevious?: boolean;
  /**
   * If set, renders a toolbar button that opens this editor in its own dockview
   * panel. Owner-only callers wire this on the inline blocks editor; the
   * dockview-panel copy doesn't pass it, so the button only shows once.
   */
  onDetach?: () => void;
}) {
  const editor = useEditorContext();
  // Captured once at editor-view construction; tools changes (account settings)
  // take effect on the next mount, which matches how the slash menu reads them.
  const editorTools = editor?.editorTools ?? DEFAULT_EDITOR_TOOLS;
  const editorToolsRef = useRef(editorTools);
  useEffect(() => {
    editorToolsRef.current = editorTools;
  });
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyHead, setHistoryHead] = useState(0);
  const [seeding, setSeeding] = useState(false);
  // The blocks editor always renders (the pinned notes index is the lowest-level
  // structure). `noStudyBlocks` toggles the empty-state callout below the
  // editor so the user can seed real study blocks. Always false for the
  // Study Body.
  const [noStudyBlocks, setNoStudyBlocks] = useState(
    () =>
      doc.kind === "blocks" && !hasStudyBlock(initialBlocksDoc(doc.content)),
  );
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const viewRef = useRef<EditorView | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  // The shared toolbar acts on whichever editor is focused; keep a stable handle
  // to the context callbacks for the view's (once-created) imperative lifecycle.
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });
  const role = doc.kind === "notes" ? "notes" : "blocks";
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persistence state (refs so the editor view's callbacks always see current
  // values without re-creating the view).
  const lastVersionRef = useRef(docHistory.headVersion);
  const lastCheckpointRef = useRef(docHistory.baseVersion);
  const pendingStepsRef = useRef<SerializedStep[]>([]);
  const flushingRef = useRef(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const clientId = crypto.randomUUID();
    const myName = me?.name;
    const myColor = me ? colorForId(me.id) : undefined;
    // Broadcast this writer's steps + cursor to read-only viewers (read-along),
    // and join presence so the owner can see who's reading along.
    let channel: RealtimeChannel | undefined;
    let disposed = false;
    // Read through a function in the async `flush` below: a call's result is
    // never value-narrowed by control-flow analysis, so the post-`await` guards
    // aren't flagged "always false" (the cleanup flips `disposed` from a
    // separate closure, which CFA can't see).
    const isDisposed = () => disposed;
    void openDocumentChannel(
      doc.id,
      {
        onPresence: (next) => {
          if (!disposed) {
            setMembers(next);
          }
        },
      },
      me ? { userId: me.id, name: me.name, isOwner: true } : undefined,
    ).then((ch) => {
      if (disposed) {
        void ch.unsubscribe();
        return;
      }
      channel = ch;
    });

    async function flush() {
      if (flushingRef.current || pendingStepsRef.current.length === 0) {
        return;
      }
      const view = viewRef.current;
      if (!view) {
        return;
      }
      flushingRef.current = true;
      const batch = pendingStepsRef.current;
      pendingStepsRef.current = [];
      const base = lastVersionRef.current;
      const newDoc = docToJSON(view.state.doc);
      try {
        const result = await appendDocumentSteps(
          doc.id,
          base,
          batch,
          newDoc,
          clientId,
        );
        // The view may have been torn down (section swap) while the save was in
        // flight — the steps are persisted, so just stop before touching it.
        if (isDisposed()) {
          return;
        }
        if (!result.ok) {
          // Another writer (the owner's other tab) advanced the doc. Discard our
          // stale pending edits and rebuild from the server head in place — no
          // jarring full-page reload.
          const head = await fetchDocumentHead(doc.id);
          if (isDisposed()) {
            return;
          }
          if (head) {
            pendingStepsRef.current = [];
            lastVersionRef.current = head.version;
            lastCheckpointRef.current = head.version;
            const fresh = EditorState.create({
              doc:
                role === "blocks"
                  ? ensureNotesIndex(initialDoc(head.content))
                  : initialDoc(head.content),
              plugins: createPlugins(placeholder, role, editorToolsRef.current),
            });
            view.updateState(fresh);
            editorRef.current?.setActive(view, fresh);
            if (role === "blocks") {
              setNoStudyBlocks(!hasStudyBlock(fresh.doc));
            }
            setStatus("saved");
            toast.info("Synced with your latest edits from another tab.");
          }
          return;
        }
        lastVersionRef.current = result.version;
        setStatus("saved");
        // A retry/transient error may have surfaced an error toast earlier; clear it.
        toast.dismiss("section-save-error");
        // Push the persisted steps + the cursor's new position to viewers.
        if (channel) {
          broadcastSteps(channel, {
            base,
            steps: batch,
            version: result.version,
          });
          broadcastCursor(channel, {
            anchor: view.state.selection.anchor,
            head: view.state.selection.head,
            version: result.version,
            name: myName,
            color: myColor,
          });
        }
        if (result.version - lastCheckpointRef.current >= CHECKPOINT_EVERY) {
          lastCheckpointRef.current = result.version;
          void createDocumentCheckpoint(doc.id).catch(() => undefined);
        }
      } catch {
        // Keep the steps and let the next change (or blur) retry. Surface a
        // single, deduped error toast (cleared on the next successful save).
        pendingStepsRef.current = [...batch, ...pendingStepsRef.current];
        setStatus("idle");
        toast.error("Couldn't save your changes. Retrying…", {
          id: "section-save-error",
        });
      } finally {
        flushingRef.current = false;
        if (pendingStepsRef.current.length > 0) {
          scheduleFlush();
        }
      }
    }

    function scheduleFlush() {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      saveTimer.current = setTimeout(() => {
        void flush();
      }, AUTOSAVE_DELAY_MS);
    }

    function flushNow() {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      void flush();
    }

    // Throttle cursor broadcasts (trailing) so rapid selection changes — e.g.
    // dragging a selection — don't flood viewers with messages.
    const CURSOR_THROTTLE_MS = 80;
    let cursorTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingCursor: { anchor: number; head: number } | null = null;
    function scheduleCursorBroadcast(anchor: number, head: number) {
      pendingCursor = { anchor, head };
      if (cursorTimer) {
        return;
      }
      cursorTimer = setTimeout(() => {
        cursorTimer = null;
        if (channel && pendingCursor) {
          broadcastCursor(channel, {
            anchor: pendingCursor.anchor,
            head: pendingCursor.head,
            version: lastVersionRef.current,
            name: myName,
            color: myColor,
          });
        }
      }, CURSOR_THROTTLE_MS);
    }

    const view = new EditorView(mount, {
      state: buildInitialState(
        docHistory,
        doc.content,
        placeholder,
        role,
        editorToolsRef.current,
      ),
      nodeViews: buildNodeViews(true),
      // The blocks doc always carries the pinned notes index now, so the
      // blocks editor is always editable. Kept as a callback to match prior
      // shape in case the invariant slips for legacy docs.
      editable: (state) =>
        role !== "blocks" || state.doc.firstChild?.type === nodes.notesIndex,
      dispatchTransaction(transaction) {
        const current = viewRef.current;
        if (!current) {
          return;
        }
        // Open a fresh undo group at word/action boundaries (Google-Docs-style).
        // `withUndoBoundary` returns the same transaction (possibly meta-tagged),
        // so the autosave step loop below is unaffected.
        const tr = withUndoBoundary(current, transaction);
        const next = current.state.apply(tr);
        current.updateState(next);
        // Editing (or moving the cursor in) this editor makes it the toolbar's
        // active target and refreshes the toolbar's active-mark states.
        editorRef.current?.setActive(current, next);
        // Track this edit in the section-wide undo order.
        recordUndo(current, next);
        if (transaction.docChanged && role === "blocks") {
          // Toggle the inside-notes-body callout as study blocks come and go.
          const empty = !hasStudyBlock(next.doc);
          setNoStudyBlocks((prev) => (prev === empty ? prev : empty));
        }
        if (transaction.docChanged) {
          for (const step of transaction.steps) {
            pendingStepsRef.current.push(stepToJSON(step));
          }
          setStatus("saving");
          scheduleFlush();
        } else if (
          transaction.selectionSet &&
          pendingStepsRef.current.length === 0
        ) {
          // Cursor moved with no unsaved edits — its position is valid at the
          // confirmed head, so viewers can place it directly (throttled).
          scheduleCursorBroadcast(next.selection.anchor, next.selection.head);
        }
      },
      handleDOMEvents: {
        focus: () => {
          const current = viewRef.current;
          if (current) {
            editorRef.current?.setActive(current, current.state);
          }
          return false;
        },
        blur: () => {
          flushNow();
          return false;
        },
      },
    });
    viewRef.current = view;
    editorRef.current?.registerView(view, role);
    registerUndoView(view);

    return () => {
      disposed = true;
      // Persist any pending edits before tearing down — otherwise a fast section
      // swap (the mine editor remounts on the new section) drops the last
      // unsaved <1.2s of typing. `flush` snapshots the doc synchronously and the
      // post-await `disposed` guards keep it from touching the destroyed view.
      flushNow();
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      if (cursorTimer) {
        clearTimeout(cursorTimer);
      }
      if (channel) {
        void channel.unsubscribe();
      }
      editorRef.current?.unregisterView(view);
      unregisterUndoView(view);
      view.destroy();
      viewRef.current = null;
    };
    // Editor is created once per document (remounted via key={document.id}).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dispatch a study-block fragment (built from server-fetched specs) into the
  // live blocks editor as one transaction — same pattern as the blocks dialog's
  // apply-on-save. Used by the empty-state action buttons. Flows through the
  // standard step pipeline (persisted, broadcast, undoable).
  async function dispatchBlockSpecs(
    fetcher: () => Promise<PMDocJSON | null>,
  ): Promise<void> {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    setSeeding(true);
    try {
      const sourceDoc = await fetcher();
      if (!sourceDoc) {
        return;
      }
      const fragment = jsonToDoc(sourceDoc).content;
      // The blocks doc always leads with the pinned notes_index now — keep it
      // and replace only the tail (the body section beneath the notes index).
      // Falls back to a full replace for any legacy doc missing the index.
      const firstChild = view.state.doc.firstChild;
      const insertStart =
        firstChild?.type === nodes.notesIndex ? firstChild.nodeSize : 0;
      const tr = view.state.tr.replaceWith(
        insertStart,
        view.state.doc.content.size,
        fragment,
      );
      tr.setMeta("allowVerseEdit", true);
      if (tr.docChanged) {
        view.dispatch(tr);
        view.focus();
      }
    } catch {
      toast.error("Couldn't add the blocks.");
    } finally {
      setSeeding(false);
    }
  }

  async function seedFromTemplate(): Promise<void> {
    if (!studyId) {
      return;
    }
    await dispatchBlockSpecs(async () => {
      const doc = await getStudyTemplateBlocksDoc(studyId);
      const specs = specsFromBlocksDoc(doc);
      return specs.length > 0 ? blocksDocFromSpecs(specs) : null;
    });
  }

  async function seedFromPrevious(): Promise<void> {
    if (!studyId || sectionPosition == null) {
      return;
    }
    await dispatchBlockSpecs(async () => {
      const specs = await getPreviousSectionBlockSpecs(
        studyId,
        sectionPosition,
      );
      return specs.length > 0 ? blocksDocFromSpecs(specs) : null;
    });
  }

  // Restore by replacing the whole doc with a past version — flows through the
  // normal step pipeline, so it's persisted, broadcast, and itself undoable.
  function applyRestore(targetDoc: PMDocJSON) {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const node = jsonToDoc(targetDoc);
    const tr = view.state.tr.replaceWith(
      0,
      view.state.doc.content.size,
      node.content,
    );
    tr.setMeta("allowVerseEdit", true);
    if (tr.docChanged) {
      view.dispatch(tr);
      // The restore is a single undoable transaction — offer a one-click revert.
      toast.success("Version restored.", {
        action: {
          label: "Undo",
          onClick: () => {
            const current = viewRef.current;
            if (current) {
              undo(current.state, current.dispatch);
              current.focus();
            }
          },
        },
      });
    }
    setHistoryOpen(false);
    view.focus();
  }

  // `status` itself is still tracked via `setStatus` calls inside the autosave
  // loop — see comment in the right-side cluster below for why the visible
  // label was removed but the state stays.
  void status;

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h2
          className={
            hideLabel
              ? "sr-only"
              : "text-sm font-semibold text-muted-foreground"
          }
        >
          {label}
        </h2>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <PresenceAvatars
            members={members.filter((member) => member.userId !== me?.id)}
          />
          {/*
            The "Saving…/Saved" status badge was intentionally removed to keep
            the right-side cluster's width stable across section navigation
            (its appear/disappear was a source of the right-side spacing
            flicker the user reported). Save reliability is unchanged — the
            persistence loop still runs; an error path still surfaces a toast.
            `setStatus`/`statusLabel` are retained so a future status surface
            (e.g. a chrome-level badge) can reuse the existing wiring.
          */}
          {doc.kind === "blocks" && studyId ? (
            <StudyBlocksDialog studyId={studyId} isTemplate={isTemplate} />
          ) : null}
          {doc.kind === "blocks" && onDetach ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDetach}
              title="Move study blocks to its own panel"
            >
              <PanelRight className="size-4" />
              Open in panel
            </Button>
          ) : null}
          {hideHistory ? null : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setHistoryHead(lastVersionRef.current);
                setHistoryOpen(true);
              }}
            >
              <History className="size-4" />
              History
            </Button>
          )}
        </div>
      </div>
      {/* The blocks editor always has the pinned notes index, so it doesn't
          need a min-height clickable canvas — applying one would just stretch
          the wrapper and leave a tall empty gap before the empty-state
          callout. The notes editor stays with `min-h-32` so an empty notes
          doc still offers a sensible click target. */}
      <div
        ref={mountRef}
        className={doc.kind === "blocks" ? undefined : "min-h-32"}
      />
      {doc.kind === "blocks" && noStudyBlocks ? (
        <div className="mt-2 rounded-lg border border-dashed border-muted-foreground/40 p-6 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No study blocks yet.</p>
          {/* Both buttons always render so the empty state's shape is stable;
              each disables (with a tooltip) when its prerequisite is missing
              — no usable template, or this is the first section. */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={seeding || !emptyStateHasTemplate}
              title={
                emptyStateHasTemplate
                  ? undefined
                  : "This study has no template blocks to copy."
              }
              onClick={() => {
                void seedFromTemplate();
              }}
            >
              Use Template Study Blocks
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={seeding || !emptyStateHasPrevious}
              title={
                emptyStateHasPrevious
                  ? undefined
                  : "This is the first section in the study."
              }
              onClick={() => {
                void seedFromPrevious();
              }}
            >
              Copy from Last Section
            </Button>
          </div>
          <p className="mt-2 text-xs">
            Or use &ldquo;Edit blocks&rdquo; above to add them manually.
          </p>
        </div>
      ) : null}
      {historyOpen ? (
        <VersionHistoryPanel
          documentId={doc.id}
          headVersion={historyHead}
          onRestore={applyRestore}
          onClose={() => {
            setHistoryOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
