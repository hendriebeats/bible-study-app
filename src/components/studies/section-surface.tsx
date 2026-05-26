"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { renameSection } from "@/app/studies/actions";
import { DocumentEditor } from "@/components/studies/document-editor";
import { DocumentViewer } from "@/components/studies/document-viewer";
import { EditorProvider } from "@/components/studies/editor-context";
import { SelectionBubble } from "@/components/studies/selection-bubble";
import { useStudyChrome } from "@/components/studies/study-chrome-context";
import { StudyToolbarPortal } from "@/components/studies/study-toolbar-portal";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { FormatRecents } from "@/lib/editor/format-actions";
import type {
  DocumentHistory,
  Section,
  SectionDocuments,
} from "@/lib/db/types";
import type { ScriptureOptions } from "@/lib/scripture/options";

/**
 * The section editing surface: the section's two documents — Notes and Study
 * blocks. Owners get the editable `DocumentEditor`; group co-members get the
 * read-only live `DocumentViewer`. (RLS enforces that only the owner can write.)
 *
 * The section title and the formatting toolbar render up in the page chrome's
 * top bar / toolbar row (via `StudyChrome`'s portal slots), so the body itself
 * is just the full-bleed document stack.
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
}) {
  const [title, setTitle] = useState(section.title);
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
  // top-bar breadcrumb slot owned by `StudyChrome`.
  const titleControl = isOwner ? (
    <Input
      value={title}
      onChange={(event) => {
        setTitle(event.target.value);
      }}
      onBlur={handleTitleBlur}
      aria-label="Section title"
      className="h-7 w-full min-w-0 border-0 bg-transparent px-0 text-sm font-medium shadow-none focus-visible:ring-0"
    />
  ) : (
    <span className="block truncate text-sm font-medium">{section.title}</span>
  );

  return (
    <EditorProvider
      sectionId={section.id}
      sectionTitle={section.title}
      initialScriptureOptions={scriptureOptions}
      initialFormatRecents={formatRecents}
    >
      {chrome?.titleSlot ? createPortal(titleControl, chrome.titleSlot) : null}
      {isOwner ? <StudyToolbarPortal /> : null}

      {/* Minimal floating menu over a text selection (portals to body). */}
      {isOwner ? <SelectionBubble /> : null}

      <div className="flex flex-col gap-4 px-6 py-5">
        {isOwner && notesHistory ? (
          <DocumentEditor
            document={documents.notes}
            history={notesHistory}
            me={me}
            label="Notes"
            placeholder="Start writing your study notes…"
          />
        ) : (
          <DocumentViewer document={documents.notes} me={me} label="Notes" />
        )}

        <Separator />

        {isOwner && blocksHistory ? (
          <DocumentEditor
            document={documents.blocks}
            history={blocksHistory}
            me={me}
            label="Study blocks"
            placeholder="Work through your study here…"
            studyId={section.study_id}
            hasPreviousSection={hasPreviousSection}
          />
        ) : (
          <DocumentViewer
            document={documents.blocks}
            me={me}
            label="Study blocks"
          />
        )}
      </div>
    </EditorProvider>
  );
}
