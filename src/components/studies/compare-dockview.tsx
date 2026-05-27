"use client";

import "dockview/dist/styles/dockview.css";

import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  themeLight,
} from "dockview";
import { Plus, RotateCcw } from "lucide-react";
import {
  createContext,
  type FunctionComponent,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import {
  type AlignCandidate,
  alignSections,
  fetchSectionForCompare,
  saveWorkspaceLayout,
  setAlignment,
} from "@/app/studies/compare-actions";
import { DocumentViewer } from "@/components/studies/document-viewer";
import type { CompareTarget } from "@/lib/db/compare";
import type { StudyDocument } from "@/lib/db/types";
import { WORKSPACE_LAYOUT_VERSION } from "@/lib/db/workspace";

interface CompareContextValue {
  mySectionId: string;
  myDoc: StudyDocument;
  myTitle: string;
  me: { id: string; name: string } | null;
}

const CompareContext = createContext<CompareContextValue | null>(null);

function useCompare(): CompareContextValue {
  const value = useContext(CompareContext);
  if (!value) {
    throw new Error("Compare panels must render inside CompareContext");
  }
  return value;
}

interface PaneState {
  status: "loading" | "ready" | "unmatched" | "error";
  candidates: AlignCandidate[];
  selectedId: string | null;
  title: string;
  doc: StudyDocument | null;
}

const INITIAL_PANE: PaneState = {
  status: "loading",
  candidates: [],
  selectedId: null,
  title: "",
  doc: null,
};

/** Left/anchor panel: my own section, pinned. */
function MinePanel(): React.ReactElement {
  const { myDoc, myTitle, me } = useCompare();
  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-3">
      <h2 className="text-sm font-semibold">
        {myTitle} <span className="text-muted-foreground">· You</span>
      </h2>
      <div className="min-h-0 flex-1">
        <DocumentViewer document={myDoc} me={me} label="Study Body" />
      </div>
    </div>
  );
}

interface PersonParams {
  targetStudyId: string;
}

/** A co-member panel: auto-aligned section + override dropdown + live read-along. */
function PersonPanel({
  params,
}: IDockviewPanelProps<PersonParams>): React.ReactElement {
  const { mySectionId, me } = useCompare();
  const { targetStudyId } = params;
  const [pane, setPane] = useState<PaneState>(INITIAL_PANE);

  useEffect(() => {
    // Object wrapper (not a bare `let`) so the cleanup's reassignment is
    // visible to the async body — a bare boolean reads as "always false" to
    // control-flow analysis and trips no-unnecessary-condition.
    const live = { current: true };
    void (async () => {
      try {
        const result = await alignSections(mySectionId, targetStudyId);
        let doc: StudyDocument | null = null;
        let title = "";
        if (result.selectedId) {
          const fetched = await fetchSectionForCompare(result.selectedId);
          if (fetched) {
            doc = fetched.notes;
            title = fetched.title;
          }
        }
        if (live.current) {
          setPane({
            status: doc ? "ready" : "unmatched",
            candidates: result.candidates,
            selectedId: result.selectedId,
            title,
            doc,
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
    setPane((prev) => ({ ...prev, status: "loading", doc: null }));
    try {
      await setAlignment(mySectionId, targetStudyId, sectionId);
      const fetched = await fetchSectionForCompare(sectionId);
      setPane((prev) => ({
        ...prev,
        status: fetched ? "ready" : "unmatched",
        selectedId: sectionId,
        title: fetched?.title ?? "",
        doc: fetched?.notes ?? null,
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

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-3">
      {pane.candidates.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Aligned to
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
      )}
      {pane.status === "loading" ? (
        <p className="text-sm text-muted-foreground">Aligning…</p>
      ) : pane.status === "unmatched" || !pane.doc ? (
        <p className="text-sm text-muted-foreground">
          No matching section found in this study.
        </p>
      ) : (
        <div className="min-h-0 flex-1">
          <DocumentViewer
            key={pane.doc.id}
            document={pane.doc}
            me={me}
            label={pane.title}
          />
        </div>
      )}
    </div>
  );
}

const PANEL_COMPONENTS: Record<
  string,
  FunctionComponent<IDockviewPanelProps>
> = {
  mine: MinePanel,
  person: PersonPanel as FunctionComponent<IDockviewPanelProps>,
};

const personPanelId = (studyId: string) => `study:${studyId}`;

export interface CompareDockviewProps {
  studyId: string;
  mySectionId: string;
  myTitle: string;
  myDoc: StudyDocument;
  targets: CompareTarget[];
  me: { id: string; name: string } | null;
  savedLayout: { layout: unknown; layoutVersion: number } | null;
}

export function CompareDockview({
  studyId,
  mySectionId,
  myTitle,
  myDoc,
  targets,
  me,
  savedLayout,
}: CompareDockviewProps): React.ReactElement {
  const apiRef = useRef<DockviewApi | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const ctxValue = useMemo<CompareContextValue>(
    () => ({ mySectionId, myDoc, myTitle, me }),
    [mySectionId, myDoc, myTitle, me],
  );

  function buildDefaultLayout(api: DockviewApi) {
    api.clear();
    api.addPanel({ id: "mine", component: "mine", title: `${myTitle} · You` });
    let previous: string | null = null;
    for (const target of targets) {
      const id = personPanelId(target.studyId);
      api.addPanel({
        id,
        component: "person",
        title: target.name,
        params: { targetStudyId: target.studyId },
        position: previous
          ? { referencePanel: previous, direction: "within" }
          : { referencePanel: "mine", direction: "right" },
      });
      previous = id;
    }
  }

  function syncOpenIds(api: DockviewApi) {
    const ids = new Set<string>();
    for (const panel of api.panels) {
      const params = panel.params as Partial<PersonParams> | undefined;
      if (params?.targetStudyId !== undefined) {
        ids.add(params.targetStudyId);
      }
    }
    setOpenIds(ids);
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
    }

    syncOpenIds(api);
    api.onDidAddPanel(() => {
      syncOpenIds(api);
    });
    api.onDidRemovePanel(() => {
      syncOpenIds(api);
    });
    api.onDidLayoutChange(() => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
      saveTimer.current = setTimeout(() => {
        void saveWorkspaceLayout(studyId, api.toJSON());
      }, 800);
    });
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  function addPerson(target: CompareTarget) {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    const id = personPanelId(target.studyId);
    const existing = api.getPanel(id);
    if (existing) {
      existing.api.setActive();
      return;
    }
    api.addPanel({
      id,
      component: "person",
      title: target.name,
      params: { targetStudyId: target.studyId },
      position: { referencePanel: "mine", direction: "right" },
    });
  }

  function resetLayout() {
    const api = apiRef.current;
    if (api) {
      buildDefaultLayout(api);
    }
  }

  if (targets.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No one else in your groups has a study to compare against yet.
      </p>
    );
  }

  const closedTargets = targets.filter((t) => !openIds.has(t.studyId));

  return (
    <CompareContext.Provider value={ctxValue}>
      <div className="flex h-full flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={resetLayout}
            className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
            Reset layout
          </button>
          {closedTargets.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Reopen:
              {closedTargets.map((t) => (
                <button
                  key={t.studyId}
                  type="button"
                  onClick={() => {
                    addPerson(t);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-foreground hover:bg-muted"
                >
                  <Plus className="size-3" />
                  {t.name}
                </button>
              ))}
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1">
          <DockviewReact
            components={PANEL_COMPONENTS}
            onReady={handleReady}
            theme={themeLight}
          />
        </div>
      </div>
    </CompareContext.Provider>
  );
}
