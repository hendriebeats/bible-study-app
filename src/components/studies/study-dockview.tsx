"use client";

import "dockview/dist/styles/dockview.css";

import {
  type DockviewApi,
  DockviewDefaultTab,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  themeLight,
} from "dockview";
import { PanelLeft } from "lucide-react";
import {
  createContext,
  type FunctionComponent,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { usePathname } from "next/navigation";

import { renameSection } from "@/app/studies/actions";
import { BodySkeleton } from "@/components/studies/body-skeleton";
import {
  type AlignCandidate,
  alignSections,
  fetchSectionForCompare,
  saveWorkspaceLayout,
  setAlignment,
} from "@/app/studies/compare-actions";
import dynamic from "next/dynamic";

import { DocumentViewer } from "@/components/studies/document-viewer";
import { HistoryPanelSkeleton } from "@/components/studies/editor-skeletons";
import { useEditorContext } from "@/components/studies/editor-context";

// The editor and history panel are by far the largest client modules in the
// app (ProseMirror schema + plugins, history virtualization). Splitting them
// out of the dockview chunk shrinks the initial study-route bundle and lets
// the dock chrome paint a frame earlier; the real editor swaps in once its
// chunk downloads. `ssr: false` matches the dockview's own boundary — both
// require the DOM. See lint-rules/heavy-modules.mjs.
//
// The `loading` fallback is `null`: the persistent `<StudiesLoadingOverlay>`
// covers the body region while the chunk downloads (and while ProseMirror
// initializes). The workspace pre-loads this module on mount so the chunk is
// usually already cached by the time `DocumentEditor` first renders.
const DocumentEditor = dynamic(
  () =>
    import("@/components/studies/document-editor").then(
      (m) => m.DocumentEditor,
    ),
  { ssr: false, loading: () => null },
);
const SectionHistoryPanel = dynamic(
  () =>
    import("@/components/studies/section-history-panel").then(
      (m) => m.SectionHistoryPanel,
    ),
  { ssr: false, loading: () => <HistoryPanelSkeleton /> },
);
import { useStudyChrome } from "@/components/studies/study-chrome-context";
import {
  type ActiveSectionPayload,
  useStudyWorkspace,
} from "@/components/studies/study-workspace-context";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

/** Plain-text fallback for an unnamed section. Used in dropdown options, the
 * dock tab title, and the DocumentViewer label — contexts where we can't ship
 * the italic/muted treatment the sidebar uses. */
function sectionDisplayTitle(title: string): string {
  return title.trim() === "" ? "New Section" : title;
}
import type { CompareTarget } from "@/lib/db/compare";
import type { SavedWorkspace } from "@/lib/db/workspace";
import type { StudyDocument } from "@/lib/db/types";
import { WORKSPACE_LAYOUT_VERSION } from "@/lib/db/workspace";
import { cn } from "@/lib/utils";

/**
 * Dock-scoped state shared by every panel inside the workspace:
 *
 *   - `me` — identity for presence + the labeled remote cursor.
 *   - `blocksDetached` — whether the study-blocks doc has been pulled out of
 *     the inline "Mine" panel into its own sibling dockview panel. The flag
 *     drives both MinePanel's render branch (inline editor vs. placeholder)
 *     and the panel-management effect in StudyDockview that adds/removes
 *     the `"blocks"` panel via the dockview api.
 */
const DockContext = createContext<{
  me: { id: string; name: string } | null;
  blocksDetached: boolean;
  setBlocksDetached: (next: boolean) => void;
} | null>(null);

function useDock(): {
  me: { id: string; name: string } | null;
  blocksDetached: boolean;
  setBlocksDetached: (next: boolean) => void;
} {
  const value = useContext(DockContext);
  if (!value) {
    throw new Error("Dock panels must render inside DockContext");
  }
  return value;
}

/* ----------------------------- Mine (editable) ---------------------------- */

/** The pinned left panel: my own section's editable Notes + Study blocks. */
function MinePanel(): React.ReactElement {
  const { active, hasSections } = useStudyWorkspace();
  // URL pattern: /studies/[studyId]/[sectionId]. We compare the URL's section
  // id against the workspace's published `active` so the panel doesn't mount
  // the editor against the previous section's data while a section nav is
  // in flight.
  const pathname = usePathname();
  const urlSectionId = pathname.split("/")[3] ?? null;

  // Version-history modal state is held HERE, above the `active.section.id
  // !== urlSectionId` placeholder gate below, on purpose. The user previously
  // hit "panel opens, then disappears mid-load" — caused by a brief workspace
  // re-publish that flipped `active` (or nulled it) just long enough for the
  // gate to swap `MineSectionBody` out for the placeholder, which unmounted
  // the panel and lost its `historyOpen` state. With state up here, the
  // modal survives any transient gate flip. We also SNAPSHOT the notes +
  // blocks ids at open-time into `historyTarget` so the modal keeps working
  // against a stable target even if `active` becomes null underneath; it
  // closes naturally when the user actually navigates to a different
  // section (the new section's MineSectionBody won't re-open it).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<{
    notesId: string;
    blocksId: string;
  } | null>(null);
  const openHistory = useCallback(() => {
    if (!active) return;
    setHistoryTarget({
      notesId: active.documents.notes.id,
      blocksId: active.documents.blocks.id,
    });
    setHistoryOpen(true);
  }, [active]);
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
  }, []);
  // Close the modal when the user navigates to a DIFFERENT section. The
  // captured `historyTarget` is from the previous section, so leaving it
  // open would show stale history for the section the user just left. We
  // gate on `active` being truthy + IDs actually differing so a transient
  // null-`active` flicker (the very thing this hoist was meant to survive)
  // doesn't close the modal.
  useEffect(() => {
    if (!active || !historyTarget) return;
    if (active.documents.notes.id !== historyTarget.notesId) {
      // Intentional setState-in-effect: this synchronizes modal state with the
      // active section. The captured historyTarget belongs to the previous
      // section, so we must close it when the user navigates away.
      /* eslint-disable react-hooks/set-state-in-effect */
      setHistoryOpen(false);
      setHistoryTarget(null);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [active, historyTarget]);

  // The "study has no sections yet" placeholder is shown only when the
  // layout's `listSections` has confirmed the study is empty — NOT just
  // because the URL is at `/studies/[id]` without a section id. Opening a
  // study from the dashboard briefly lands on `/studies/[id]` before the
  // index page's redirect fires; without this gate the placeholder flashed
  // during that window.
  if (!hasSections) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        <div>
          <p>This study has no sections yet.</p>
          <p className="mt-1">Use “Add section” in the sidebar to begin.</p>
        </div>
      </div>
    );
  }
  // The persistent `<StudiesLoadingOverlay>` (rendered as a sibling of the
  // layout's Suspense) covers this panel until `WorkspaceInner` flips
  // `body[data-studies-body-ready]`. So `MinePanel` just renders content
  // unconditionally — no local skeleton or overlay logic. During the
  // URL-ahead window (a section nav in flight) the overlay is still up
  // because `editor.activeView` is briefly null between unmount/remount of
  // the section's editors, so the panel can render `MineSectionBody`
  // immediately without flashing the previous section.
  const bodyMatchesUrl = active?.section.id === urlSectionId;
  return (
    <>
      {active && bodyMatchesUrl ? (
        // Re-key on the section so the title field + editors remount cleanly
        // when switching sections (the panel itself, and the dock, stay
        // mounted).
        <MineSectionBody
          key={active.section.id}
          payload={active}
          onOpenHistory={openHistory}
        />
      ) : (
        // Placeholder rather than `MineSectionBody` so the editors don't
        // briefly mount against the previous section's data while we're
        // between published payloads.
        <div className="h-full" />
      )}
      {historyOpen && historyTarget ? (
        <SectionHistoryPanel
          notesId={historyTarget.notesId}
          blocksId={historyTarget.blocksId}
          onClose={closeHistory}
        />
      ) : null}
    </>
  );
}

/**
 * Inline blocks renderer used inside the "Mine" panel. When the user has
 * detached blocks into its own dockview panel, this swaps for a slim
 * placeholder so we don't co-edit the same doc twice; the placeholder's
 * "Bring blocks back" button flips the dock state and re-attaches.
 */
function InlineBlocksEditor({
  blocksDoc,
  blocksHistory,
  me,
  studyId,
  isTemplate,
  sectionPosition,
  emptyStateHasTemplate,
  emptyStateHasPrevious,
}: {
  blocksDoc: StudyDocument;
  blocksHistory: NonNullable<ActiveSectionPayload["blocksHistory"]>;
  me: { id: string; name: string } | null;
  studyId: string;
  isTemplate: boolean;
  sectionPosition: number;
  emptyStateHasTemplate: boolean;
  emptyStateHasPrevious: boolean;
}): React.ReactElement {
  const { blocksDetached, setBlocksDetached } = useDock();
  if (blocksDetached) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <span>Study blocks open in a separate panel.</span>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted"
          onClick={() => {
            setBlocksDetached(false);
          }}
        >
          <PanelLeft className="size-3.5" />
          Bring back here
        </button>
      </div>
    );
  }
  return (
    <DocumentEditor
      document={blocksDoc}
      history={blocksHistory}
      me={me}
      label="Study blocks"
      hideLabel
      placeholder="Work through your study here…"
      studyId={studyId}
      isTemplate={isTemplate}
      sectionPosition={sectionPosition}
      emptyStateHasTemplate={emptyStateHasTemplate}
      emptyStateHasPrevious={emptyStateHasPrevious}
      onDetach={() => {
        setBlocksDetached(true);
      }}
    />
  );
}

/**
 * The dockview "blocks" panel — opened when the user clicks "Open in panel"
 * on the inline blocks editor, and removed when they close the tab or hit
 * "Bring back here". Renders the *active* section's blocks editor, re-keyed
 * on `section.id` so navigating sections remounts the editor cleanly the
 * same way {@link MinePanel} does.
 *
 * Shares MinePanel's URL-ahead-of-active check so a section navigation swaps
 * this panel to the body skeleton too — without it, the panel would briefly
 * keep showing the previous section's blocks until the new payload publishes.
 * `showTitle={false}` because this panel renders blocks only (no editable
 * section title above the body).
 */
function BlocksDockPanel(): React.ReactElement {
  const { active } = useStudyWorkspace();
  const { me } = useDock();
  const pathname = usePathname();
  const urlSectionId = pathname.split("/")[3] ?? null;
  // The persistent `<StudiesLoadingOverlay>` covers the body during cold
  // load; the URL-ahead gate just keeps the panel from rendering against the
  // previous section's data while a navigation is in flight.
  if (active?.section.id !== urlSectionId) {
    return <div className="h-full" />;
  }
  // Read-only viewers can't detach (no button), but a layout restore could
  // bring back a stale "blocks" panel — render the viewer for safety.
  if (!active.isOwner || !active.blocksHistory) {
    return (
      <div className="h-full overflow-auto px-6 py-5">
        <DocumentViewer
          document={active.documents.blocks}
          me={me}
          label="Study blocks"
          hideLabel
        />
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto px-6 py-5">
      <DocumentEditor
        key={active.section.id}
        document={active.documents.blocks}
        history={active.blocksHistory}
        me={me}
        label="Study blocks"
        hideLabel
        placeholder="Work through your study here…"
        studyId={active.section.study_id}
        isTemplate={active.isTemplate}
        sectionPosition={active.section.position}
        emptyStateHasTemplate={active.emptyStateHasTemplate}
        emptyStateHasPrevious={active.emptyStateHasPrevious}
      />
    </div>
  );
}

function MineSectionBody({
  payload,
  onOpenHistory,
}: {
  payload: ActiveSectionPayload;
  /**
   * Open the section's version-history modal. State lives one level up in
   * `MinePanel` so the modal survives transient remounts of this component
   * (the placeholder gate flips it during workspace re-publishes); see the
   * comment on `historyTarget` in {@link MinePanel}.
   */
  onOpenHistory: () => void;
}): React.ReactElement {
  const { me } = useDock();
  const chrome = useStudyChrome();
  const editor = useEditorContext();
  const {
    section,
    documents,
    notesHistory,
    blocksHistory,
    isOwner,
    isTemplate,
    emptyStateHasTemplate,
    emptyStateHasPrevious,
  } = payload;
  const [title, setTitle] = useState(section.title);
  const titleRef = useRef<HTMLInputElement>(null);

  function handleTitleBlur() {
    // Allow blank: a cleared title persists as "" and the sidebar / tab fall
    // back to "New Section" as a visual label. (Previously this forced an
    // "Untitled section" string into the DB, which prevented the placeholder
    // UX from ever appearing.)
    const next = title.trim();
    if (next !== section.title) {
      void renameSection(section.id, section.study_id, next);
    }
  }

  // Consume a sidebar-requested action (Version History / Rename) targeting
  // this section. The sidebar sets the pending request and navigates; this
  // runs once the section is mounted, then clears it. Also handles the "same
  // section, no nav" case (the pending state change re-fires this effect).
  const pendingAction = chrome?.pendingSectionAction;
  const clearPendingSectionAction = chrome?.clearPendingSectionAction;
  useEffect(() => {
    if (pendingAction?.sectionId !== section.id) {
      return;
    }
    const kind = pendingAction.kind;
    // Defer the state changes out of the effect body — both to satisfy the
    // "no setState inside effect" rule and (for rename) to fire past the
    // dropdown's focus-restore on close, so the input keeps focus.
    const handle = requestAnimationFrame(() => {
      if (kind === "history") {
        onOpenHistory();
      } else {
        const input = titleRef.current;
        if (input) {
          input.focus();
          input.select();
        }
      }
      clearPendingSectionAction?.();
    });
    return () => {
      cancelAnimationFrame(handle);
    };
  }, [pendingAction, section.id, clearPendingSectionAction, onOpenHistory]);

  // When the sidebar is collapsed, the chrome floats a re-open button over the
  // body's top-left — pad this (leftmost) panel so the title clears it.
  const sidebarOpen = chrome?.sidebarOpen ?? true;

  return (
    <div className="h-full overflow-auto">
      <div
        className={cn(
          "flex flex-col gap-4 py-5",
          sidebarOpen ? "px-6" : "pr-6 pl-14",
        )}
      >
        {isOwner ? (
          <Input
            ref={titleRef}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              // Publish live so the left TOC + dock tab update as you type;
              // handleTitleBlur still persists the trimmed value on commit.
              chrome?.setSectionTitle(section.id, event.target.value);
            }}
            onBlur={handleTitleBlur}
            aria-label="Section title"
            placeholder="Enter section title…"
            className="h-9 w-full min-w-0 border-0 bg-transparent px-0 text-xl font-semibold shadow-none placeholder:font-normal placeholder:text-muted-foreground/60 focus-visible:ring-0"
          />
        ) : (
          <span className="block truncate text-xl font-semibold">
            {section.title || (
              <span className="text-muted-foreground/70 italic">
                New Section
              </span>
            )}
          </span>
        )}

        {isOwner && notesHistory ? (
          <DocumentEditor
            document={documents.notes}
            history={notesHistory}
            me={me}
            label="Study Body"
            hideLabel
            placeholder="Write your study…"
            // Owner + empty body → the scripture-prompt overlay swaps in for
            // the bare placeholder. The handler opens the same panel as the
            // toolbar's BookOpen button (state is hoisted into the editor
            // context so both surfaces share one source of truth).
            emptyOwnerScripturePrompt={
              editor
                ? {
                    onOpenScripture: () => {
                      editor.setScriptureOpen(true);
                    },
                  }
                : undefined
            }
          />
        ) : (
          <DocumentViewer
            document={documents.notes}
            me={me}
            label="Study Body"
            hideLabel
          />
        )}

        <Separator />

        {isOwner && blocksHistory ? (
          <InlineBlocksEditor
            blocksDoc={documents.blocks}
            blocksHistory={blocksHistory}
            me={me}
            studyId={section.study_id}
            isTemplate={isTemplate}
            sectionPosition={section.position}
            emptyStateHasTemplate={emptyStateHasTemplate}
            emptyStateHasPrevious={emptyStateHasPrevious}
          />
        ) : (
          <DocumentViewer
            document={documents.blocks}
            me={me}
            label="Study blocks"
            hideLabel
          />
        )}
      </div>

      {/* The version-history modal is rendered by `MinePanel` (one level up)
          so it survives any transient remount of `MineSectionBody`. The
          sidebar's ⋮ → Version History wires through `onOpenHistory` to set
          the modal state up there. */}
    </div>
  );
}

/* ---------------------------- Person (read-only) -------------------------- */

interface PaneState {
  status: "loading" | "ready" | "unmatched" | "error";
  candidates: AlignCandidate[];
  selectedId: string | null;
  title: string;
  notes: StudyDocument | null;
  blocks: StudyDocument | null;
}

const INITIAL_PANE: PaneState = {
  status: "loading",
  candidates: [],
  selectedId: null,
  title: "",
  notes: null,
  blocks: null,
};

interface PersonParams {
  targetStudyId: string;
}

/** A co-member panel: auto-aligned section (notes + blocks) + override dropdowns. */
function PersonPanel({
  params,
}: IDockviewPanelProps<PersonParams>): React.ReactElement {
  const { me } = useDock();
  const { active } = useStudyWorkspace();
  const mySectionId = active?.section.id ?? "";
  const { targetStudyId } = params;
  const [pane, setPane] = useState<PaneState>(INITIAL_PANE);

  useEffect(() => {
    if (mySectionId === "") {
      return;
    }
    // Object wrapper (not a bare `let`) so the cleanup's reassignment is visible
    // to the async body (a bare boolean reads as "always false" to control-flow
    // analysis and trips no-unnecessary-condition).
    const live = { current: true };
    void (async () => {
      try {
        const result = await alignSections(mySectionId, targetStudyId);
        let notes: StudyDocument | null = null;
        let blocks: StudyDocument | null = null;
        let title = "";
        if (result.selectedId) {
          const fetched = await fetchSectionForCompare(result.selectedId);
          if (fetched) {
            notes = fetched.notes;
            blocks = fetched.blocks;
            title = fetched.title;
          }
        }
        if (live.current) {
          setPane({
            status: notes ? "ready" : "unmatched",
            candidates: result.candidates,
            selectedId: result.selectedId,
            title,
            notes,
            blocks,
          });
        }
      } catch {
        if (live.current) {
          toast.error("Couldn't load that study to compare.");
          setPane((prev) => ({ ...prev, status: "error" }));
        }
      }
    })();
    return () => {
      live.current = false;
    };
  }, [mySectionId, targetStudyId]);

  async function changeSelection(sectionId: string) {
    setPane((prev) => ({
      ...prev,
      status: "loading",
      notes: null,
      blocks: null,
    }));
    try {
      await setAlignment(mySectionId, targetStudyId, sectionId);
      const fetched = await fetchSectionForCompare(sectionId);
      setPane((prev) => ({
        ...prev,
        status: fetched ? "ready" : "unmatched",
        selectedId: sectionId,
        title: fetched?.title ?? "",
        notes: fetched?.notes ?? null,
        blocks: fetched?.blocks ?? null,
      }));
    } catch {
      toast.error("Couldn't change the aligned section.");
    }
  }

  if (pane.status === "error") {
    return (
      <p className="p-3 text-sm text-destructive">
        Something went wrong loading this study.
      </p>
    );
  }

  // Same sections, two lenses: "Best match" keeps the alignment ranking (top =
  // closest to my section); "Their sections" lists them in the study's own
  // reading order so you can deliberately browse the rest of their study.
  const byPosition = [...pane.candidates].sort(
    (a, b) => a.position - b.position,
  );

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-3">
      {pane.candidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            Best match
            <select
              value={pane.selectedId ?? ""}
              onChange={(event) => {
                void changeSelection(event.target.value);
              }}
              className="rounded-md border bg-background px-2 py-1 text-sm text-foreground"
            >
              {pane.candidates.map((c) => (
                <option key={c.sectionId} value={c.sectionId}>
                  {sectionDisplayTitle(c.title)}
                  {c.lineageMatch ? " · same slot" : ""}
                  {c.overlap > 0
                    ? ` · ${Math.round(c.overlap * 100).toString()}% overlap`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Their sections
            <select
              value={pane.selectedId ?? ""}
              onChange={(event) => {
                void changeSelection(event.target.value);
              }}
              className="rounded-md border bg-background px-2 py-1 text-sm text-foreground"
            >
              {byPosition.map((c) => (
                <option key={c.sectionId} value={c.sectionId}>
                  {sectionDisplayTitle(c.title)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {pane.status === "loading" ? (
        // Both first-load (no candidates yet → dropdown row hidden, skeleton
        // fills the panel) and a mid-session changeSelection (dropdown row
        // visible above, skeleton below) flow through this branch.
        // `showTitle={false}` — a co-member's section title lives in the
        // dropdown row above, not inside the body.
        <BodySkeleton showTitle={false} />
      ) : pane.status === "unmatched" || !pane.notes || !pane.blocks ? (
        <p className="text-sm text-muted-foreground">
          No matching section found in this study.
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <DocumentViewer
            key={pane.notes.id}
            document={pane.notes}
            me={me}
            label={sectionDisplayTitle(pane.title)}
          />
          <Separator />
          <DocumentViewer
            key={pane.blocks.id}
            document={pane.blocks}
            me={me}
            label="Study blocks"
          />
        </div>
      )}
    </div>
  );
}

/* -------------------------------- The dock -------------------------------- */

/**
 * The pinned "mine" tab: the default dockview tab with its close action hidden,
 * so the panel can't be closed. Its title is kept in sync with the current
 * section by {@link StudyDockview} via `panel.api.setTitle`.
 */
function MineTab(props: IDockviewPanelHeaderProps): React.ReactElement {
  return <DockviewDefaultTab {...props} hideClose />;
}

const BLOCKS_PANEL_ID = "blocks";

const PANEL_COMPONENTS: Record<
  string,
  FunctionComponent<IDockviewPanelProps>
> = {
  mine: MinePanel,
  person: PersonPanel as FunctionComponent<IDockviewPanelProps>,
  blocks: BlocksDockPanel,
};

const TAB_COMPONENTS: Record<
  string,
  FunctionComponent<IDockviewPanelHeaderProps>
> = {
  pinned: MineTab,
};

const personPanelId = (studyId: string) => `study:${studyId}`;

export interface StudyDockviewProps {
  studyId: string;
  me: { id: string; name: string } | null;
  targets: CompareTarget[];
  savedLayout: SavedWorkspace | null;
}

export function StudyDockview({
  studyId,
  me,
  targets,
  savedLayout,
}: StudyDockviewProps): React.ReactElement {
  const workspace = useStudyWorkspace();
  const chrome = useStudyChrome();
  const editor = useEditorContext();
  const apiRef = useRef<DockviewApi | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panelCount, setPanelCount] = useState(0);
  const [ready, setReady] = useState(false);
  // Whether the study-blocks doc is in its own dockview panel (true) vs.
  // inlined inside the "Mine" panel (false). The on-ready handler reconciles
  // this with any restored layout so the placeholder isn't stale.
  const [blocksDetached, setBlocksDetached] = useState(false);

  // `registerDockHandlers` and `publishOpenMemberIds` are stable (useCallback
  // in the provider); depend on them, not the whole workspace value (which
  // changes identity every section nav and would otherwise unregister the
  // handlers on every navigation).
  const { active, registerDockHandlers, publishOpenMemberIds } = workspace;
  // Prefer the live title the "mine" panel publishes as you type, so the tab
  // tracks a rename in real time; fall back to the server-rendered title.
  const activeTitle = active
    ? (chrome?.sectionTitleOverrides[active.section.id] ?? active.section.title)
    : null;
  useEffect(() => {
    if (!ready) {
      return;
    }
    const panel = apiRef.current?.getPanel("mine");
    // Blank titles fall back to "New Section" so the tab reads as a real label
    // rather than ` · You` with a leading separator. Mirrors the sidebar.
    panel?.api.setTitle(
      activeTitle != null
        ? `${sectionDisplayTitle(activeTitle)} · You`
        : "My study",
    );
  }, [ready, activeTitle]);

  // handleReady runs once; read the freshest targets through a ref so a member
  // who joins mid-session can still be opened by id.
  const targetsRef = useRef(targets);
  useEffect(() => {
    targetsRef.current = targets;
  });

  function addPanelForTarget(api: DockviewApi, target: CompareTarget) {
    api.addPanel({
      id: personPanelId(target.studyId),
      component: "person",
      title: target.name,
      params: { targetStudyId: target.studyId },
      position: { referencePanel: "mine", direction: "right" },
    });
  }

  function addMine(api: DockviewApi) {
    api.addPanel({
      id: "mine",
      component: "mine",
      tabComponent: "pinned",
      title: "My study",
    });
  }

  // A fresh / reset layout is just the pinned "mine" panel — a solo editor.
  // Co-members are opened on demand (the toolbar "Group" menu or a roster deep
  // link); once opened, the saved layout restores them on the next visit.
  function buildDefaultLayout(api: DockviewApi) {
    api.clear();
    addMine(api);
  }

  function syncPanels(api: DockviewApi) {
    const ids = new Set<string>();
    for (const panel of api.panels) {
      const params = panel.params as Partial<PersonParams> | undefined;
      if (params?.targetStudyId !== undefined) {
        ids.add(params.targetStudyId);
      }
    }
    setPanelCount(api.panels.length);
    // Push the set up to the workspace so the toolbar "Group" dropdown's
    // checkbox-style member rows stay in sync (open/close from the tab × is
    // mirrored here too).
    publishOpenMemberIds(ids);
  }

  function addPerson(target: CompareTarget) {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    const existing = api.getPanel(personPanelId(target.studyId));
    if (existing) {
      existing.api.setActive();
      return;
    }
    addPanelForTarget(api, target);
  }

  function openPersonById(personStudyId: string) {
    const target = targetsRef.current.find((t) => t.studyId === personStudyId);
    if (target) {
      addPerson(target);
    }
  }

  function closePersonById(personStudyId: string) {
    apiRef.current?.getPanel(personPanelId(personStudyId))?.api.close();
  }

  function handleReady(event: DockviewReadyEvent) {
    const api = event.api;
    apiRef.current = api;

    let restored = false;
    if (savedLayout?.layoutVersion === WORKSPACE_LAYOUT_VERSION) {
      try {
        api.fromJSON(savedLayout.layout as Parameters<typeof api.fromJSON>[0]);
        restored = api.panels.length > 0;
      } catch {
        restored = false;
      }
    }
    if (!restored) {
      buildDefaultLayout(api);
    } else if (!api.getPanel("mine")) {
      // A restored layout must always include the pinned, non-closable mine
      // panel — re-add it leftmost if it somehow isn't there.
      addMine(api);
    }

    syncPanels(api);
    // If a restored layout brought back the blocks panel, mirror that into
    // state so the inline placeholder renders instead of the editor.
    setBlocksDetached(api.getPanel(BLOCKS_PANEL_ID) !== undefined);
    api.onDidAddPanel((panel) => {
      if (panel.id === BLOCKS_PANEL_ID) {
        setBlocksDetached(true);
      }
      syncPanels(api);
    });
    api.onDidRemovePanel((panel) => {
      // The user closed the blocks tab → bring it back inline.
      if (panel.id === BLOCKS_PANEL_ID) {
        setBlocksDetached(false);
      }
      syncPanels(api);
    });
    api.onDidLayoutChange(() => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      saveTimer.current = setTimeout(() => {
        void saveWorkspaceLayout(studyId, api.toJSON());
      }, 800);
    });

    // Expose the panel handlers so the toolbar Group dropdown can open/close
    // members and the "Hide all members" footer can clear the layout. A
    // `?focus=` deep link queued before this point fires now via `open`.
    registerDockHandlers({
      open: openPersonById,
      close: closePersonById,
      reset: resetLayout,
    });
    setReady(true);
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      registerDockHandlers(null);
    };
  }, [registerDockHandlers]);

  // Expose a probe to the editor context so `createNote` can ask "is the
  // blocks doc detached AND the currently visible tab in its group?" — when
  // it is, the post-create flow drops the caret into the new note entry
  // inline instead of opening the floating popover. The probe closes over
  // `apiRef`, so it always reads the live dockview state without needing a
  // re-render to refresh.
  const setDockBlocksVisibilityProbe = editor?.setDockBlocksVisibilityProbe;
  useEffect(() => {
    if (!setDockBlocksVisibilityProbe) {
      return;
    }
    setDockBlocksVisibilityProbe(() => {
      const panel = apiRef.current?.getPanel(BLOCKS_PANEL_ID);
      if (!panel) {
        return false;
      }
      // NOTE: `panel.api.isActive` reads the GROUP's active state (i.e. "is
      // this group the one the user last interacted with?"), not "is this
      // panel the visible tab in its group". Add Note is triggered from the
      // mine editor, which makes the mine group active — so `isActive` is
      // false on the blocks panel even though it's clearly on-screen in its
      // own group. What we actually want is "is blocks the visible tab in
      // whichever group it lives in", which is exactly `group.activePanel`.
      return panel.api.group.activePanel?.id === BLOCKS_PANEL_ID;
    });
    return () => {
      setDockBlocksVisibilityProbe(null);
    };
  }, [setDockBlocksVisibilityProbe]);

  // Reconcile the dockview panel state with the React `blocksDetached` flag.
  // The flag is the source of truth; this effect adds the panel when it goes
  // true and closes it when it goes false. Both branches are idempotent:
  // adds when missing, closes when present — so re-fires of this effect
  // (e.g. from the close handler flipping state back) are no-ops.
  useEffect(() => {
    if (!ready) {
      return;
    }
    const api = apiRef.current;
    if (!api) {
      return;
    }
    const existing = api.getPanel(BLOCKS_PANEL_ID);
    if (blocksDetached && !existing) {
      api.addPanel({
        id: BLOCKS_PANEL_ID,
        component: BLOCKS_PANEL_ID,
        title: "Study blocks",
        position: { referencePanel: "mine", direction: "right" },
      });
    } else if (!blocksDetached && existing) {
      existing.api.close();
    }
  }, [ready, blocksDetached]);

  function resetLayout() {
    const api = apiRef.current;
    if (api) {
      buildDefaultLayout(api);
    }
  }

  // Only "mine" is open: hide the dock tab bar (via the data attribute + a rule
  // in globals.css) and the in-dock controls so a solo study reads as a plain
  // editor. Adding a member (toolbar "Group" menu) reveals both.
  const singlePanel = panelCount <= 1;

  return (
    <DockContext.Provider value={{ me, blocksDetached, setBlocksDetached }}>
      <div
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2"
        data-study-dock=""
        data-single-panel={singlePanel || undefined}
      >
        <div className="min-h-0 flex-1">
          <DockviewReact
            components={PANEL_COMPONENTS}
            tabComponents={TAB_COMPONENTS}
            onReady={handleReady}
            theme={themeLight}
          />
        </div>
      </div>
    </DockContext.Provider>
  );
}
