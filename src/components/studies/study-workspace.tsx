"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { BlockMenu } from "@/components/studies/block-menu";
import { CalloutColorPopover } from "@/components/studies/callout-color-popover";
import { TableHandlePopover } from "@/components/studies/table-handle-popover";
import {
  EditorProvider,
  useEditorContext,
} from "@/components/studies/editor-context";
import { GroupMembersMenu } from "@/components/studies/group-members-menu";
import { NotePopover } from "@/components/studies/note-popover";
import { SelectionBubble } from "@/components/studies/selection-bubble";
import { SlashMenu } from "@/components/studies/slash-menu";
import { StudyDock } from "@/components/studies/study-dock";
import { StudyToolbarPortal } from "@/components/studies/study-toolbar-portal";
import {
  type ActiveSectionPayload,
  StudyWorkspaceContext,
  type StudyWorkspaceValue,
  useStudyWorkspace,
} from "@/components/studies/study-workspace-context";
import type { CompareTarget } from "@/lib/db/compare";
import type { StudyGroupInfo } from "@/lib/db/types";
import type { SavedWorkspace } from "@/lib/db/workspace";
import type { EditorTools } from "@/lib/editor/editor-tools";
import type { FormatRecents } from "@/lib/editor/format-actions";
import type { ScriptureOptions } from "@/lib/scripture/options";

interface StudyWorkspaceProps {
  studyId: string;
  /** Identity for presence + a labeled remote cursor (read-along). */
  me: { id: string; name: string } | null;
  /**
   * Whether the study has any sections (from the layout's `listSections`).
   * Exposed via the workspace context so `MinePanel` can tell apart
   * "loading first section" from "study truly has no sections" — the
   * placeholder used to flash during the studyId-index redirect because
   * the URL had no section id and `active` was still null.
   */
  hasSections: boolean;
  /** Other group members with a live study (the dock's openable panels). */
  compareTargets: CompareTarget[];
  /** The group(s) this study belongs to (drives the members menu + info popup). */
  groupContext: StudyGroupInfo[];
  /** This user's saved dock layout for the study (panels + splits). */
  savedLayout: SavedWorkspace | null;
  /** User-scoped editor settings (stable across sections). */
  scriptureOptions: ScriptureOptions;
  formatRecents: FormatRecents;
  editorTools: EditorTools;
  children: ReactNode;
}

/**
 * The persistent per-study workspace, mounted once at the `[studyId]` layout
 * level so it survives section navigation. It hosts the hoisted `EditorProvider`
 * (the toolbar acts on whichever section editor is focused), the owner's
 * floating menus, and the dock — a pinned editable "mine" panel plus any open
 * read-only co-member panels. The `[sectionId]` page renders a `SectionBridge`
 * as `children` that publishes the current section's data up into here.
 */
export function StudyWorkspace({
  studyId,
  me,
  hasSections,
  compareTargets,
  groupContext,
  savedLayout,
  scriptureOptions,
  formatRecents,
  editorTools,
  children,
}: StudyWorkspaceProps) {
  const [active, setActive] = useState<ActiveSectionPayload | null>(null);

  // Pre-load the `DocumentEditor` chunk as soon as the workspace mounts so the
  // editor (the app's largest client module — see the comment in
  // `study-dockview.tsx`) starts downloading in parallel with the section
  // page's server fetch instead of waiting for `MinePanel` to render. Pure
  // fire-and-forget: the dock's panels gate their reveal on
  // `editorContext.activeView` (the actual "an editor view is mounted"
  // signal), so we don't need to track chunk-load state ourselves.
  useEffect(() => {
    void import("@/components/studies/document-editor");
  }, []);

  // The dock registers its panel handlers once ready; a focus request that
  // arrives before the (dynamically imported) dock has loaded is queued and
  // flushed on registration. Close/reset before registration are no-ops —
  // there can't be any open member panels yet for them to act on.
  const openPersonRef = useRef<((studyId: string) => void) | null>(null);
  const closePersonRef = useRef<((studyId: string) => void) | null>(null);
  const resetMembersRef = useRef<(() => void) | null>(null);
  const pendingPersonRef = useRef<string | null>(null);
  const [openMemberIds, setOpenMemberIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const publish = useCallback((payload: ActiveSectionPayload) => {
    setActive(payload);
  }, []);

  // Intentionally a no-op. The old `SectionBridge`'s `useLayoutEffect` cleanup
  // fires BEFORE the new section's mount effect, so naïvely clearing would
  // flash `active` to null between sections — the toolbar, dock chrome, and
  // per-section bits would visibly unmount + remount.
  //
  // Section nav always publishes the new payload immediately on mount, so we
  // let `active` stay sticky to the previous section until the new one
  // overwrites it. When the user truly leaves the studies area, the workspace
  // itself unmounts and `active` is discarded with it.
  //
  // The `sectionId` parameter is kept for API stability — `SectionBridge`
  // still calls `clear(payload.section.id)` on unmount.
  const clear = useCallback((_sectionId: string) => {
    // No-op — see comment above.
  }, []);

  const openPerson = useCallback((personStudyId: string) => {
    if (openPersonRef.current) {
      openPersonRef.current(personStudyId);
    } else {
      pendingPersonRef.current = personStudyId;
    }
  }, []);

  const closePerson = useCallback((personStudyId: string) => {
    closePersonRef.current?.(personStudyId);
  }, []);

  const resetMembers = useCallback(() => {
    resetMembersRef.current?.();
  }, []);

  const registerDockHandlers = useCallback(
    (
      handlers: {
        open: (studyId: string) => void;
        close: (studyId: string) => void;
        reset: () => void;
      } | null,
    ) => {
      if (handlers) {
        openPersonRef.current = handlers.open;
        closePersonRef.current = handlers.close;
        resetMembersRef.current = handlers.reset;
        if (pendingPersonRef.current !== null) {
          handlers.open(pendingPersonRef.current);
          pendingPersonRef.current = null;
        }
      } else {
        openPersonRef.current = null;
        closePersonRef.current = null;
        resetMembersRef.current = null;
        // No dock = no open panels.
        setOpenMemberIds(new Set());
      }
    },
    [],
  );

  // Called by the dock's syncPanels on every panel change. Stable identity so
  // the dock can call it freely without re-registering.
  const publishOpenMemberIds = useCallback((ids: ReadonlySet<string>) => {
    setOpenMemberIds(ids);
  }, []);

  const value = useMemo<StudyWorkspaceValue>(
    () => ({
      active,
      hasSections,
      publish,
      clear,
      openPerson,
      closePerson,
      resetMembers,
      openMemberIds,
      registerDockHandlers,
      publishOpenMemberIds,
    }),
    [
      active,
      hasSections,
      publish,
      clear,
      openPerson,
      closePerson,
      resetMembers,
      openMemberIds,
      registerDockHandlers,
      publishOpenMemberIds,
    ],
  );

  return (
    <StudyWorkspaceContext.Provider value={value}>
      <WorkspaceInner
        studyId={studyId}
        me={me}
        compareTargets={compareTargets}
        groupContext={groupContext}
        savedLayout={savedLayout}
        scriptureOptions={scriptureOptions}
        formatRecents={formatRecents}
        editorTools={editorTools}
      >
        {children}
      </WorkspaceInner>
    </StudyWorkspaceContext.Provider>
  );
}

/**
 * Inner shell that reads the active section so the hoisted `EditorProvider`
 * stays section-reactive (its `insertScripture`/`prefillReference` re-derive on
 * the section id/title) while the provider itself — and the dock and editors it
 * wraps — never remount across section navigation.
 */
function WorkspaceInner({
  studyId,
  me,
  compareTargets,
  groupContext,
  savedLayout,
  scriptureOptions,
  formatRecents,
  editorTools,
  children,
}: Omit<StudyWorkspaceProps, "children" | "hasSections"> & {
  children: ReactNode;
}) {
  const { active } = useStudyWorkspace();
  const isOwner = active?.isOwner ?? false;
  const sectionId = active?.section.id ?? "";
  const sectionTitle = active?.section.title ?? "";

  return (
    <EditorProvider
      sectionId={sectionId}
      sectionTitle={sectionTitle}
      initialScriptureOptions={scriptureOptions}
      initialFormatRecents={formatRecents}
      initialEditorTools={editorTools}
    >
      <StudiesBodyReadyBridge isOwner={isOwner} hasActive={active != null} />
      {/* Owners get the shared toolbar (with the group menu) + floating menus;
          co-members read along with neither. */}
      {isOwner ? (
        <StudyToolbarPortal
          trailing={
            <GroupMembersMenu
              studyId={studyId}
              sectionId={sectionId}
              targets={compareTargets}
              groupContext={groupContext}
              meId={me?.id ?? ""}
            />
          }
        />
      ) : null}
      {isOwner ? <SelectionBubble /> : null}
      {isOwner ? <SlashMenu /> : null}
      {isOwner ? <BlockMenu /> : null}
      {isOwner ? <CalloutColorPopover /> : null}
      {isOwner ? <TableHandlePopover /> : null}
      {isOwner ? <NotePopover /> : null}

      <StudyDock
        studyId={studyId}
        me={me}
        targets={compareTargets}
        savedLayout={savedLayout}
      />

      {children}
    </EditorProvider>
  );
}

/**
 * Toggles `body[data-studies-body-ready="true"]` so the persistent
 * `<StudiesLoadingOverlay>` can fade out (the CSS rule lives in
 * `globals.css`). The signal is:
 *   - **Owners**: ready once the editor context has an `activeView`
 *     (= a `<DocumentEditor>` has registered its ProseMirror view).
 *   - **Viewers**: ready as soon as `active` is published — they don't have
 *     an editor at all (just `<DocumentViewer>`), so the editor signal would
 *     never fire and the overlay would never lift.
 *
 * The bridge renders nothing. It lives inside `EditorProvider` so it can read
 * `activeView` without exposing the editor context further up the tree.
 */
function StudiesBodyReadyBridge({
  isOwner,
  hasActive,
}: {
  isOwner: boolean;
  hasActive: boolean;
}) {
  const editor = useEditorContext();
  const editorMounted = editor?.activeView != null;
  const ready = isOwner ? editorMounted : hasActive;
  useEffect(() => {
    if (!ready) {
      return;
    }
    document.body.dataset.studiesBodyReady = "true";
    return () => {
      delete document.body.dataset.studiesBodyReady;
    };
  }, [ready]);
  return null;
}
