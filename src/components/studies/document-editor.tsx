"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { gapCursor } from "prosemirror-gapcursor";
import { closeHistory, history } from "prosemirror-history";
import { BookOpen, PanelRight } from "lucide-react";
import { keymap } from "prosemirror-keymap";
import type { Node } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { columnResizing, tableEditing } from "prosemirror-tables";
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
import { ImageEditorIntegration } from "@/components/studies/image-editor-integration";
import { PresenceAvatars } from "@/components/studies/presence-avatars";
import { StudyBlocksDialog } from "@/components/studies/study-blocks-dialog";
import { Button } from "@/components/ui/button";
import type { DocumentHistory, StudyDocument } from "@/lib/db/types";
import { blocksDocFromSpecs, specsFromBlocksDoc } from "@/lib/editor/blocks";
import { makeModASelect } from "@/lib/editor/commands";
import { isDocEmpty } from "@/lib/editor/doc-utils";
import {
  DEFAULT_EDITOR_TOOLS,
  type EditorTools,
} from "@/lib/editor/editor-tools";
import { buildNodeViews } from "@/lib/editor/node-views";
import { buildInputRules } from "@/lib/editor/plugins/input-rules";
import { buildKeymaps } from "@/lib/editor/plugins/keymap";
import { blockHandle } from "@/lib/editor/plugins/block-handle";
import { crossRefDetect } from "@/lib/editor/plugins/cross-ref-detect";
import { blocksSelectionGuard } from "@/lib/editor/plugins/blocks-selection-guard";
import { blocksStructureGuard } from "@/lib/editor/plugins/blocks-structure-guard";
import { trashRemovedImages } from "@/lib/editor/image-trash";
import { imagePastePlugin } from "@/lib/editor/plugins/image-paste";
import { linkClickPlugin } from "@/lib/editor/plugins/link-click";
import { linkPastePlugin } from "@/lib/editor/plugins/link-paste";
import { linkPreviewPlugin } from "@/lib/editor/plugins/link-preview";
import { noteAnchors } from "@/lib/editor/plugins/note-anchors";
import { notesIndexGuard } from "@/lib/editor/plugins/notes-index-guard";
import { placeholder as placeholderPlugin } from "@/lib/editor/plugins/placeholder";
import { slashMenu } from "@/lib/editor/plugins/slash-menu";
import {
  applyIndentRunDrop,
  applyIndentRunDropAtPosition,
  type DropInstruction,
} from "@/lib/editor/indent-run";
import {
  type BlockDragState,
  blockDragPlugin,
  getBlockDragState,
  probeIndicatorRect,
} from "@/lib/editor/plugins/block-drag";
import { computeDropInstruction } from "@/lib/editor/plugins/block-handle";
import { selectionShadowPlugin } from "@/lib/editor/plugins/selection-shadow";
import { TableViewWithHandles } from "@/lib/editor/plugins/table-view";
import { themedColors } from "@/lib/editor/plugins/themed-colors";
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
import {
  UNDO_GROUP_DELAY_MS,
  isUndoBoundary,
  withUndoBoundary,
} from "@/lib/editor/word-undo";
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
  imageContext?: { studyId: string; userId: string } | null,
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
    // Tables: `columnResizing` installs `TableViewWithHandles` (drag handles
    // for rows/columns + `+` quick-adds + edge drag for column width), and
    // `tableEditing` adds cell selection + Tab/Shift-Tab cell navigation.
    // Order matters: columnResizing must come before tableEditing.
    columnResizing({ View: TableViewWithHandles }),
    tableEditing(),
    // Inline clickable icon at the end of each note-anchored range.
    noteAnchors(),
    // Keep the pinned notes index from being deleted (no-op in the body editor).
    notesIndexGuard(),
    placeholderPlugin(placeholderText),
    // Auto-detect scripture references typed in prose, wrap them in a chip
    // mark, and rewrite the typed form to the canonical name on commit.
    // Inert (just renders pre-existing chips) when the user's
    // `crossRefAutoDetect` tool is off.
    crossRefDetect(tools),
    // Paint a fallback highlight on the selection while the editor is blurred
    // so the user can see what their next toolbar action will affect.
    selectionShadowPlugin(),
    // Owns the visual side of the hierarchical block drag (ghost source +
    // drop-indicator widget). The pointer driver in block-handle.ts pokes
    // it via meta transactions on pointermove / pointerup.
    blockDragPlugin(),
    // Link UX: smart paste (URL on selection → wrap; URL on caret → insert
    // + fetch title), click-to-edit (with Cmd-click to follow), and the
    // shared hover preview detector. Always on — Links are no longer a
    // per-user opt-in.
    linkPastePlugin(),
    linkClickPlugin(),
    linkPreviewPlugin(),
    // Paints the active theme's contrast-safe variant of any custom-colour
    // highlight / text-colour mark over the schema's baked-in stored value.
    // Updates flow through PM's transaction loop (Decoration.inline), so the
    // page never fights PM's DOMObserver — the earlier direct-DOM binder
    // froze the tab on theme toggle. See
    // src/lib/editor/plugins/themed-colors.ts.
    themedColors(),
  ];
  // Image paste / drop interceptor: clipboard files, drag-drop, and HTML
  // `<img>` paste all route through the upload pipeline so everything lands
  // in our study-images bucket (no off-site `src` ever in the doc). Gated on
  // the user's opt-in toggle AND on having a study/user context (the
  // template editor's notes-only preview won't carry studyId, for example).
  if (tools.images && imageContext) {
    plugins.push(imagePastePlugin(imageContext));
  }
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
  imageContext?: { studyId: string; userId: string } | null,
) {
  const startDoc =
    role === "blocks"
      ? ensureNotesIndex(initialDoc(bundle.baseDoc))
      : initialDoc(bundle.baseDoc);
  try {
    let state = EditorState.create({
      doc: startDoc,
      plugins: createPlugins(placeholderText, role, tools, imageContext),
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
      plugins: createPlugins(placeholderText, role, tools, imageContext),
    });
  }
}

/**
 * Editable, autosaving editor for ONE document (notes or blocks) the user owns.
 * Persists ProseMirror steps via the document RPCs with optimistic concurrency,
 * broadcasts them + the cursor to read-along viewers, and snapshots checkpoints
 * to bound replay length. Version history is exposed one level up — at the
 * section ⋮ menu — by {@link SectionHistoryPanel}; this editor has no per-doc
 * History button. The section title lives one level up too.
 */
export function DocumentEditor({
  document: doc,
  history: docHistory,
  me,
  label,
  hideLabel = false,
  placeholder,
  studyId,
  isTemplate = false,
  sectionPosition,
  emptyStateHasTemplate = false,
  emptyStateHasPrevious = false,
  emptyOwnerScripturePrompt,
  onDetach,
}: {
  document: StudyDocument;
  history: DocumentHistory;
  me: { id: string; name: string } | null;
  label: string;
  /** Keep the label for screen readers but hide it visually (still shows the controls row). */
  hideLabel?: boolean;
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
   * When set, an instructional empty-state overlay replaces the bare
   * placeholder as long as the doc is empty: a BookOpen icon, a heading
   * ("Add Scripture to Get Started"), and a sub-line pointing at the
   * scripture button in the top toolbar. Clicking the overlay calls
   * `onOpenScripture` (the same handler the toolbar button uses). Currently
   * passed only on the owner's notes editor — viewers and the blocks editor
   * keep the default placeholder.
   */
  emptyOwnerScripturePrompt?: { onOpenScripture: () => void };
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
  // Image-paste plugin needs both studyId and userId to build bucket paths.
  // null when either is missing (template-only previews, signed-out flows) —
  // gate the plugin off in that case so paste falls back to PM's default.
  const imageContextRef = useRef<{ studyId: string; userId: string } | null>(
    studyId && me ? { studyId, userId: me.id } : null,
  );
  useEffect(() => {
    imageContextRef.current = studyId && me ? { studyId, userId: me.id } : null;
  }, [me, studyId]);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [seeding, setSeeding] = useState(false);
  // The blocks editor always renders (the pinned notes index is the lowest-level
  // structure). `noStudyBlocks` toggles the empty-state callout below the
  // editor so the user can seed real study blocks. Always false for the
  // Study Body.
  const [noStudyBlocks, setNoStudyBlocks] = useState(
    () =>
      doc.kind === "blocks" && !hasStudyBlock(initialBlocksDoc(doc.content)),
  );
  // True while the editor's doc is the schema's blank state (a lone empty
  // paragraph). Drives the owner-only "Add Scripture to Get Started" overlay
  // on the notes editor — passed in via `emptyOwnerScripturePrompt`; ignored
  // when no prompt is provided (e.g. the blocks editor, viewer paths).
  const [isEmpty, setIsEmpty] = useState(() =>
    isDocEmpty(initialDoc(doc.content)),
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
  // 0-indexed positions inside `pendingStepsRef` where a NEW word/action group
  // begins (per `isUndoBoundary` — the same predicate that drives `closeHistory`
  // tagging in `dispatchTransaction`). Flushed alongside the steps so persisted
  // history shows one moment per word/action — the same granularity as Cmd-Z —
  // instead of one moment per ~1.2s autosave batch. The very first step of a
  // batch implicitly starts a group; only boundaries DURING the batch are
  // recorded here.
  const pendingBoundariesRef = useRef<number[]>([]);
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
      const boundaries = pendingBoundariesRef.current;
      pendingStepsRef.current = [];
      pendingBoundariesRef.current = [];
      const base = lastVersionRef.current;
      const newDoc = docToJSON(view.state.doc);
      // Collect every image-node `src` in the new doc — the server diffs this
      // against the previously-persisted set to surface orphans for soft
      // delete. Skip placeholder URLs (`pending:{uuid}`) from in-flight
      // uploads; only real bucket URLs are tracked.
      const imageSrcs: string[] = [];
      view.state.doc.descendants((n) => {
        if (n.type.name === "image") {
          const src = n.attrs.src as unknown;
          if (typeof src === "string" && src && !src.startsWith("pending:")) {
            imageSrcs.push(src);
          }
        }
        return true;
      });
      try {
        const result = await appendDocumentSteps(
          doc.id,
          base,
          batch,
          newDoc,
          clientId,
          boundaries,
          imageSrcs,
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
            pendingBoundariesRef.current = [];
            lastVersionRef.current = head.version;
            lastCheckpointRef.current = head.version;
            const fresh = EditorState.create({
              doc:
                role === "blocks"
                  ? ensureNotesIndex(initialDoc(head.content))
                  : initialDoc(head.content),
              plugins: createPlugins(
                placeholder,
                role,
                editorToolsRef.current,
                imageContextRef.current,
              ),
            });
            view.updateState(fresh);
            editorRef.current?.setActive(view, fresh);
            if (role === "blocks") {
              setNoStudyBlocks(!hasStudyBlock(fresh.doc));
            }
            setIsEmpty(isDocEmpty(fresh.doc));
            setStatus("saved");
            toast.info("Synced with your latest edits from another tab.");
          }
          return;
        }
        lastVersionRef.current = result.version;
        setStatus("saved");
        // Per-save image cleanup: the RPC told us which srcs disappeared
        // from this document — move their bucket files into `_trash/` so the
        // daily sweep can hard-delete after the 30-day retention window. A
        // version-history restore inside that window resurrects them via
        // `resurrectTrashedImages`. Best-effort: failures are logged and the
        // next save will redo the diff.
        if (result.removedImageSrcs.length > 0) {
          void trashRemovedImages(result.removedImageSrcs);
        }
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
        // Boundaries collected after we drained must shift right by the
        // re-prepended batch length so they keep pointing at the same step.
        const shift = batch.length;
        pendingStepsRef.current = [...batch, ...pendingStepsRef.current];
        pendingBoundariesRef.current = [
          ...boundaries,
          ...pendingBoundariesRef.current.map((i) => i + shift),
        ];
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
        imageContextRef.current,
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
          // Mirror the empty/non-empty doc shape into React so the owner-only
          // scripture-prompt overlay appears the moment the doc empties and
          // disappears on the user's first character.
          const nextEmpty = isDocEmpty(next.doc);
          setIsEmpty((prev) => (prev === nextEmpty ? prev : nextEmpty));
        }
        if (transaction.docChanged) {
          // The very first step of a pending batch implicitly opens a group,
          // so we only record an explicit boundary when the batch is non-empty
          // AND this transaction is a word/action boundary (the same predicate
          // `withUndoBoundary` used above to tag undo groups).
          if (
            pendingStepsRef.current.length > 0 &&
            isUndoBoundary(current, transaction)
          ) {
            pendingBoundariesRef.current.push(pendingStepsRef.current.length);
          }
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

    // Playwright debug hook — exposes a tiny window-level introspection API
    // so e2e specs can read the current doc shape without poking at PM
    // internals. Always on in development (where Playwright runs against a
    // shared `next dev`) and when `NEXT_PUBLIC_PM_DEBUG=1` is set explicitly.
    // Always off in production builds.
    //
    // Multiple editors mount on the same page (notes body + blocks body, plus
    // any read-along panes in group studies). Rather than letting the last
    // mount overwrite the global, every editor REGISTERS its view into a
    // shared list and `getDocJSON()` returns whichever view currently has
    // browser focus — which is the surface the test just typed into.
    if (
      typeof window !== "undefined" &&
      (process.env.NEXT_PUBLIC_PM_DEBUG === "1" ||
        process.env.NODE_ENV !== "production")
    ) {
      interface PMDebugApi {
        views: Set<EditorView>;
        getDocJSON: () => unknown;
        getView: () => EditorView | null;
        getFocusedView: () => EditorView | null;
        /**
         * Test-only: run an indent-run drop against the focused view's
         * state. Mirrors what the pointer driver dispatches on pointerup,
         * so Playwright can lock down the structural outcome without
         * synthesizing pointer events (which teleport and miss the
         * gutter-hover bridge per playwright-testing-notes.md).
         *
         * Two shapes are accepted so the legacy 4-tuple call sites
         * (existing e2e specs) keep working alongside the new instruction
         * form. The 4-tuple form is a shim that maps `(pos, indent)` onto
         * `reorder-above` / `reorder-below` depending on where pos lands.
         */
        simulateBlockDrop: ((
          sourceStart: number,
          sourceEnd: number,
          targetPos: number,
          targetIndent: number,
        ) => boolean) &
          ((
            sourceStart: number,
            sourceEnd: number,
            instruction: DropInstruction,
          ) => boolean);
        /**
         * Test-only: mirror the prod pointer-driver's pointerup dispatch so
         * specs can measure the viewport effect of `scrollIntoView`. See
         * the implementation block below for full doc.
         */
        simulatePointerDrop: (
          sourceStart: number,
          sourceEnd: number,
          instruction: DropInstruction,
          opts?: { scrollIntoView?: boolean },
        ) => boolean;
        /**
         * Test-only: viewport-coord rect the drop indicator WOULD paint at
         * for a hypothetical instruction. Used to lock down the rule that
         * `make-child R` and `reorder-above R.next` produce the same Y at
         * the indent-(R.indent + 1) column — see drag-seam-indicator spec.
         */
        probeIndicatorRect: (
          instruction: DropInstruction,
          sourceStart: number,
          sourceEnd: number,
        ) => {
          top: number;
          left: number;
          width: number;
          height: number;
        } | null;
        /**
         * Test-only: read the live block-drag plugin state on the focused
         * view (idle | active w/ instruction). Used by the manual pixel-
         * sweep diagnostic in plans/i-want-paragraph-buzzing-quilt.md.
         */
        getBlockDragState: () => BlockDragState | null;
        /**
         * Test-only: ask the driver "what DropInstruction would you emit at
         * this client (x, y) for a drag of the given source range?" without
         * starting a real drag. Lets the manual pixel sweep map every
         * coordinate to its computed instruction (or null) so we can see
         * gap dead-zones and seam transitions.
         */
        probeDropInstruction: (
          clientX: number,
          clientY: number,
          sourceStart: number,
          sourceEnd: number,
          rootIndent: number,
        ) => DropInstruction | null;
      }
      const w = window as unknown as { __PM_DEBUG__?: PMDebugApi };
      if (!w.__PM_DEBUG__) {
        const views = new Set<EditorView>();
        const focused = (): EditorView | null => {
          for (const v of views) {
            if (v.hasFocus()) return v;
          }
          // No focused view (a stale read, or focus moved to a toolbar) —
          // fall back to any view at all so the helper still returns a doc.
          const first = views.values().next();
          return first.done === true ? null : first.value;
        };
        w.__PM_DEBUG__ = {
          views,
          getDocJSON: (): unknown => focused()?.state.doc.toJSON() ?? null,
          getView: focused,
          getFocusedView: focused,
          getBlockDragState: (): BlockDragState | null => {
            const v = focused();
            return v ? getBlockDragState(v) : null;
          },
          probeDropInstruction: (
            clientX: number,
            clientY: number,
            sourceStart: number,
            sourceEnd: number,
            rootIndent: number,
          ): DropInstruction | null => {
            const v = focused();
            if (!v) return null;
            // Fabricate the subset of PointerEvent that computeDropInstruction
            // actually reads. Casting through unknown is required because
            // PointerEvent has many more fields we don't need.
            const fakeEvent = {
              clientX,
              clientY,
            } as unknown as PointerEvent;
            return computeDropInstruction(
              v,
              fakeEvent,
              sourceStart,
              sourceEnd,
              rootIndent,
            );
          },
          simulateBlockDrop: (
            sourceStart: number,
            sourceEnd: number,
            third: number | DropInstruction,
            fourth?: number,
          ): boolean => {
            const v = focused();
            if (!v) return false;
            const tr =
              typeof third === "number"
                ? applyIndentRunDropAtPosition(
                    v.state,
                    sourceStart,
                    sourceEnd,
                    third,
                    typeof fourth === "number" ? fourth : 0,
                  )
                : applyIndentRunDrop(v.state, sourceStart, sourceEnd, third);
            if (!tr) return false;
            v.dispatch(tr);
            return true;
          },
          /**
           * Test-only: mirrors what the production pointer-driver dispatches
           * on pointerup — same `applyIndentRunDrop` call, optionally with
           * `tr.scrollIntoView()`. Lets a regression spec measure whether
           * `scrollIntoView` is what's causing the post-drop scroll jump
           * without having to synthesize real pointer events.
           */
          simulatePointerDrop: (
            sourceStart: number,
            sourceEnd: number,
            instruction: DropInstruction,
            opts?: { scrollIntoView?: boolean },
          ): boolean => {
            const v = focused();
            if (!v) return false;
            const tr = applyIndentRunDrop(
              v.state,
              sourceStart,
              sourceEnd,
              instruction,
            );
            if (!tr) return false;
            v.dispatch(
              opts?.scrollIntoView === true ? tr.scrollIntoView() : tr,
            );
            return true;
          },
          probeIndicatorRect: (
            instruction: DropInstruction,
            sourceStart: number,
            sourceEnd: number,
          ) => {
            const v = focused();
            if (!v) return null;
            return probeIndicatorRect(v, instruction, sourceStart, sourceEnd);
          },
        };
      }
      w.__PM_DEBUG__.views.add(view);
    }

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
      // Pull the view out of the dev debug registry so a stale entry doesn't
      // resolve later (no-op in production where the global was never set).
      const debugApi = (
        window as unknown as {
          __PM_DEBUG__?: { views: Set<EditorView> };
        }
      ).__PM_DEBUG__;
      debugApi?.views.delete(view);
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

  // `status` itself is still tracked via `setStatus` calls inside the autosave
  // loop — see comment in the right-side cluster below for why the visible
  // label was removed but the state stays.
  void status;

  return (
    <div>
      {/* Insert dialog + crop overlay listen for CustomEvents bubbled from
          inside the editor; mounted here so they share the editor's lifetime
          and have access to studyId/userId. No-op when either is missing
          (template previews, signed-out viewers). */}
      {studyId && me ? (
        <ImageEditorIntegration studyId={studyId} userId={me.id} />
      ) : null}
      <div className="mb-2 flex items-center gap-3">
        <h2
          className={
            hideLabel
              ? "sr-only"
              : "text-ui font-semibold text-muted-foreground"
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
        </div>
      </div>
      {/* The blocks editor always has the pinned notes index, so it doesn't
          need a min-height clickable canvas — applying one would just stretch
          the wrapper and leave a tall empty gap before the empty-state
          callout. The notes editor stays with `min-h-32` so an empty notes
          doc still offers a sensible click target. The relative wrapper exists
          so the empty-owner scripture prompt can overlay the editor area. */}
      <div className="relative">
        <div
          ref={mountRef}
          // `data-empty-overlay` hides the CSS `::before` placeholder when the
          // React overlay is showing instead — see the matching selector in
          // `globals.css`. The attribute is harmless when no overlay is present.
          data-empty-overlay={
            isEmpty && emptyOwnerScripturePrompt ? "true" : undefined
          }
          className={doc.kind === "blocks" ? undefined : "min-h-32"}
        />
        {isEmpty && emptyOwnerScripturePrompt ? (
          <EmptyScripturePromptOverlay
            onClick={emptyOwnerScripturePrompt.onOpenScripture}
          />
        ) : null}
      </div>
      {doc.kind === "blocks" && noStudyBlocks ? (
        <div className="mt-2 rounded-lg border border-dashed border-muted-foreground/40 p-6 text-center text-ui text-muted-foreground">
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
          <p className="mt-2 text-caption">
            Or use &ldquo;Edit blocks&rdquo; above to add them manually.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The owner-only empty-state shown over the Study Body when the doc has no
 * content yet. Sits on top of the editor's empty paragraph (the `relative`
 * wrapper in {@link DocumentEditor}). The outer container is
 * `pointer-events-none` so clicks pass through to the editor below — the user
 * can still click anywhere in the empty body to focus it and type freely (just
 * like a normal placeholder). Only the inner BookOpen button intercepts
 * clicks, opening the scripture-insert panel. The sub-line renders the same
 * `BookOpen` icon as the toolbar button so the connection between the two is
 * visual, not just verbal.
 */
function EmptyScripturePromptOverlay({
  onClick,
}: {
  onClick: () => void;
}): React.ReactElement {
  return (
    <div className="pointer-events-none absolute inset-0 flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/10 p-6 text-center text-ui text-muted-foreground">
      <button
        type="button"
        onClick={onClick}
        // `mousedown` prevents the editor below from grabbing focus before the
        // panel opens — without it the editor steals focus and the user has to
        // tab back to the panel.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        aria-label="Add Scripture to Get Started"
        className="pointer-events-auto flex flex-col items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted/30"
      >
        <BookOpen className="size-8 text-foreground/60" aria-hidden />
        <span className="font-medium text-foreground">
          Add Scripture to Get Started
        </span>
        <span className="text-caption">
          Click the{" "}
          <BookOpen className="inline size-3.5 -translate-y-0.5" aria-hidden />{" "}
          in the top bar.
        </span>
      </button>
    </div>
  );
}
