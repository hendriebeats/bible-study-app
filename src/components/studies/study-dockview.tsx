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
import { Check, History, Plus, RotateCcw } from "lucide-react";
import {
  createContext,
  type FunctionComponent,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { renameSection } from "@/app/studies/actions";
import {
  type AlignCandidate,
  alignSections,
  fetchSectionForCompare,
  saveWorkspaceLayout,
  setAlignment,
} from "@/app/studies/compare-actions";
import { DocumentEditor } from "@/components/studies/document-editor";
import { DocumentViewer } from "@/components/studies/document-viewer";
import { SectionHistoryPanel } from "@/components/studies/section-history-panel";
import { useStudyChrome } from "@/components/studies/study-chrome-context";
import {
  type ActiveSectionPayload,
  useStudyWorkspace,
} from "@/components/studies/study-workspace-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { CompareTarget } from "@/lib/db/compare";
import type { SavedWorkspace } from "@/lib/db/workspace";
import type { StudyDocument } from "@/lib/db/types";
import { WORKSPACE_LAYOUT_VERSION } from "@/lib/db/workspace";
import { cn } from "@/lib/utils";

/** Dock-scoped identity (presence + labeled cursor) for every panel's editors. */
const DockContext = createContext<{
  me: { id: string; name: string } | null;
} | null>(null);

function useDock(): { me: { id: string; name: string } | null } {
  const value = useContext(DockContext);
  if (!value) {
    throw new Error("Dock panels must render inside DockContext");
  }
  return value;
}

/* ----------------------------- Mine (editable) ---------------------------- */

/** The pinned left panel: my own section's editable Notes + Study blocks. */
function MinePanel(): React.ReactElement {
  const { active } = useStudyWorkspace();
  if (!active) {
    // Only persists for a study with no sections — section routes publish their
    // payload before paint, so this never flashes on navigation.
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        <div>
          <p>This study has no sections yet.</p>
          <p className="mt-1">Use “Add section” in the sidebar to begin.</p>
        </div>
      </div>
    );
  }
  // Re-key on the section so the title field + editors remount cleanly when
  // switching sections (the panel itself, and the dock, stay mounted).
  return <MineSectionBody key={active.section.id} payload={active} />;
}

function MineSectionBody({
  payload,
}: {
  payload: ActiveSectionPayload;
}): React.ReactElement {
  const { me } = useDock();
  const chrome = useStudyChrome();
  const {
    section,
    documents,
    notesHistory,
    blocksHistory,
    isOwner,
    isTemplate,
  } = payload;
  const [title, setTitle] = useState(section.title);
  const [historyOpen, setHistoryOpen] = useState(false);

  function handleTitleBlur() {
    const next = title.trim() || "Untitled section";
    if (next !== section.title) {
      void renameSection(section.id, section.study_id, next);
    }
  }

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
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              // Publish live so the left TOC + dock tab update as you type;
              // handleTitleBlur still persists the trimmed value on commit.
              chrome?.setSectionTitle(section.id, event.target.value);
            }}
            onBlur={handleTitleBlur}
            aria-label="Section title"
            className="h-9 w-full min-w-0 border-0 bg-transparent px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
          />
        ) : (
          <span className="block truncate text-xl font-semibold">
            {section.title}
          </span>
        )}

        {isOwner ? (
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setHistoryOpen(true);
              }}
            >
              <History className="size-4" />
              History
            </Button>
          </div>
        ) : null}

        {isOwner && notesHistory ? (
          <DocumentEditor
            document={documents.notes}
            history={notesHistory}
            me={me}
            label="Study Body"
            hideLabel
            hideHistory
            placeholder="Write your study…"
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
          <DocumentEditor
            document={documents.blocks}
            history={blocksHistory}
            me={me}
            label="Study blocks"
            hideLabel
            hideHistory
            placeholder="Work through your study here…"
            studyId={section.study_id}
            isTemplate={isTemplate}
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

      {isOwner && historyOpen ? (
        <SectionHistoryPanel
          notesId={documents.notes.id}
          blocksId={documents.blocks.id}
          onClose={() => {
            setHistoryOpen(false);
          }}
        />
      ) : null}
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
                  {c.title}
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
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {pane.status === "loading" ? (
        <p className="text-sm text-muted-foreground">Aligning…</p>
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
            label={pane.title}
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

const PANEL_COMPONENTS: Record<
  string,
  FunctionComponent<IDockviewPanelProps>
> = {
  mine: MinePanel,
  person: PersonPanel as FunctionComponent<IDockviewPanelProps>,
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
  const apiRef = useRef<DockviewApi | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [panelCount, setPanelCount] = useState(0);
  const [ready, setReady] = useState(false);

  // `registerOpenPerson` is stable (useCallback in the provider); depend on it,
  // not the whole workspace value (which changes identity every section nav and
  // would otherwise unregister the opener on every navigation).
  const { active, registerOpenPerson } = workspace;
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
    panel?.api.setTitle(
      activeTitle != null ? `${activeTitle} · You` : "My study",
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
    setOpenIds(ids);
    setPanelCount(api.panels.length);
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
    api.onDidAddPanel(() => {
      syncPanels(api);
    });
    api.onDidRemovePanel(() => {
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

    // Expose the panel-opener so the toolbar group menu / a `?focus=` deep link
    // can open a member; flushes any focus request queued before this point.
    registerOpenPerson(openPersonById);
    setReady(true);
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      registerOpenPerson(null);
    };
  }, [registerOpenPerson]);

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
    <DockContext.Provider value={{ me }}>
      <div
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2"
        data-study-dock=""
        data-single-panel={singlePanel || undefined}
      >
        {!singlePanel && targets.length > 0 ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-2 pt-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-foreground hover:bg-muted"
                >
                  <Plus className="size-3.5" />
                  Add member
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Studies to compare</DropdownMenuLabel>
                {targets.map((t) => {
                  const open = openIds.has(t.studyId);
                  return (
                    <DropdownMenuItem
                      key={t.studyId}
                      className="justify-between"
                      onSelect={() => {
                        addPerson(t);
                      }}
                    >
                      <span className="truncate">{t.name}</span>
                      {open ? (
                        <Check className="size-4 text-muted-foreground" />
                      ) : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              onClick={resetLayout}
              className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="size-3.5" />
              Reset layout
            </button>
          </div>
        ) : null}
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
