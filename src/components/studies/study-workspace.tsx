"use client";

import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import { BlockMenu } from "@/components/studies/block-menu";
import { EditorProvider } from "@/components/studies/editor-context";
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
  compareTargets,
  groupContext,
  savedLayout,
  scriptureOptions,
  formatRecents,
  editorTools,
  children,
}: StudyWorkspaceProps) {
  const [active, setActive] = useState<ActiveSectionPayload | null>(null);

  // The dock registers its panel-opener once ready; a focus request that
  // arrives before the (dynamically imported) dock has loaded is queued and
  // flushed on registration.
  const openPersonRef = useRef<((studyId: string) => void) | null>(null);
  const pendingPersonRef = useRef<string | null>(null);

  const publish = useCallback((payload: ActiveSectionPayload) => {
    setActive(payload);
  }, []);

  const publishHistory = useCallback(
    (
      sectionId: string,
      notesHistory: ActiveSectionPayload["notesHistory"],
      blocksHistory: ActiveSectionPayload["blocksHistory"],
    ) => {
      setActive((prev) =>
        prev?.section.id === sectionId
          ? { ...prev, notesHistory, blocksHistory }
          : prev,
      );
    },
    [],
  );

  const clear = useCallback((sectionId: string) => {
    setActive((prev) => (prev?.section.id === sectionId ? null : prev));
  }, []);

  const openPerson = useCallback((personStudyId: string) => {
    if (openPersonRef.current) {
      openPersonRef.current(personStudyId);
    } else {
      pendingPersonRef.current = personStudyId;
    }
  }, []);

  const registerOpenPerson = useCallback(
    (open: ((studyId: string) => void) | null) => {
      openPersonRef.current = open;
      if (open && pendingPersonRef.current !== null) {
        open(pendingPersonRef.current);
        pendingPersonRef.current = null;
      }
    },
    [],
  );

  const value = useMemo<StudyWorkspaceValue>(
    () => ({
      active,
      publish,
      publishHistory,
      clear,
      openPerson,
      registerOpenPerson,
    }),
    [active, publish, publishHistory, clear, openPerson, registerOpenPerson],
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
}: Omit<StudyWorkspaceProps, "children"> & { children: ReactNode }) {
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
