"use client";

import { History } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { renameSection } from "@/app/studies/actions";
import { DocumentEditor } from "@/components/studies/document-editor";
import { DocumentViewer } from "@/components/studies/document-viewer";
import { EditorProvider } from "@/components/studies/editor-context";
import { BlockMenu } from "@/components/studies/block-menu";
import { GroupMembersMenu } from "@/components/studies/group-members-menu";
import { NotePopover } from "@/components/studies/note-popover";
import { SectionHistoryPanel } from "@/components/studies/section-history-panel";
import { SelectionBubble } from "@/components/studies/selection-bubble";
import { SlashMenu } from "@/components/studies/slash-menu";
import { useStudyChrome } from "@/components/studies/study-chrome-context";
import { StudyToolbarPortal } from "@/components/studies/study-toolbar-portal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { CompareTarget } from "@/lib/db/compare";
import type { EditorTools } from "@/lib/editor/editor-tools";
import type { FormatRecents } from "@/lib/editor/format-actions";
import type {
  DocumentHistory,
  Section,
  SectionDocuments,
  StudyGroupInfo,
} from "@/lib/db/types";
import type { ScriptureOptions } from "@/lib/scripture/options";

/**
 * The section editing surface: the section's two documents — Notes and Study
 * blocks. Owners get the editable `DocumentEditor`; group co-members get the
 * read-only live `DocumentViewer`. (RLS enforces that only the owner can write.)
 *
 * The formatting toolbar renders up in the page chrome's toolbar row, and the
 * section title renders at the top of the document body — both via
 * `StudyChrome`'s portal slots, so this component stays section-data-driven.
 */
export function SectionSurface({
  section,
  documents,
  notesHistory,
  blocksHistory,
  hasPreviousSection,
  isOwner,
  canCompare,
  me,
  scriptureOptions,
  formatRecents,
  editorTools,
  compareTargets,
  groupContext,
}: {
  section: Section;
  documents: SectionDocuments;
  notesHistory: DocumentHistory | null;
  blocksHistory: DocumentHistory | null;
  hasPreviousSection: boolean;
  isOwner: boolean;
  canCompare: boolean;
  me: { id: string; name: string } | null;
  scriptureOptions: ScriptureOptions;
  formatRecents: FormatRecents;
  editorTools: EditorTools;
  /** Other group members with a live study (for the toolbar members menu). */
  compareTargets: CompareTarget[];
  /** The group(s) this study belongs to (drives the members menu + info popup). */
  groupContext: StudyGroupInfo[];
}) {
  const [title, setTitle] = useState(section.title);
  const [historyOpen, setHistoryOpen] = useState(false);
  const chrome = useStudyChrome();

  function handleTitleBlur() {
    const next = title.trim() || "Untitled section";
    if (next !== section.title) {
      void renameSection(section.id, section.study_id, next);
    }
  }

  // Publish this section's Compare target into the top bar (cleared on unmount /
  // when navigating to a section without a comparison).
  const compareHref = canCompare
    ? `/studies/${section.study_id}/compare/${section.id}`
    : null;
  useEffect(() => {
    chrome?.setCompareHref(compareHref);
    return () => {
      chrome?.setCompareHref(null);
    };
  }, [chrome, compareHref]);

  // The editable (owner) / read-only (viewer) section title — rendered into the
  // section-title slot at the top of the document body, owned by `StudyChrome`.
  const titleControl = isOwner ? (
    <Input
      value={title}
      onChange={(event) => {
        setTitle(event.target.value);
      }}
      onBlur={handleTitleBlur}
      aria-label="Section title"
      className="h-9 w-full min-w-0 border-0 bg-transparent px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
    />
  ) : (
    <span className="block truncate text-xl font-semibold">
      {section.title}
    </span>
  );

  return (
    <EditorProvider
      sectionId={section.id}
      sectionTitle={section.title}
      initialScriptureOptions={scriptureOptions}
      initialFormatRecents={formatRecents}
      initialEditorTools={editorTools}
    >
      {chrome?.titleSlot ? createPortal(titleControl, chrome.titleSlot) : null}
      {isOwner ? (
        <StudyToolbarPortal
          trailing={
            <GroupMembersMenu
              studyId={section.study_id}
              sectionId={section.id}
              targets={compareTargets}
              groupContext={groupContext}
              meId={me?.id ?? ""}
            />
          }
        />
      ) : null}

      {/* Minimal floating menu over a text selection (portals to body). */}
      {isOwner ? <SelectionBubble /> : null}
      {/* "/" command menu at the caret (portals to body). */}
      {isOwner ? <SlashMenu /> : null}
      {/* Block options menu opened by the gutter handle (portals to body). */}
      {isOwner ? <BlockMenu /> : null}
      {/* Draggable editor for a shared note (portals to body). */}
      {isOwner ? <NotePopover /> : null}

      <div className="flex flex-col gap-4 px-6 py-5">
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
            hasPreviousSection={hasPreviousSection}
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
    </EditorProvider>
  );
}
