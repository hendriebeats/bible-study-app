"use client";

import { Columns2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { renameSection } from "@/app/studies/actions";
import { DocumentEditor } from "@/components/studies/document-editor";
import { DocumentViewer } from "@/components/studies/document-viewer";
import { EditorProvider } from "@/components/studies/editor-context";
import { EditorToolbar } from "@/components/studies/editor-toolbar";
import { SelectionBubble } from "@/components/studies/selection-bubble";
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
 * The section editing surface: the (owner-editable) section title plus the
 * section's two documents — Notes and Study blocks. Owners get the editable
 * `DocumentEditor`; group co-members get the read-only live `DocumentViewer`.
 * (RLS enforces that only the owner can write.) Each document scrolls in its
 * own pane — a preview of the dockable layout that Phase 3 introduces.
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

  function handleTitleBlur() {
    const next = title.trim() || "Untitled section";
    if (next !== section.title) {
      void renameSection(section.id, section.study_id, next);
    }
  }

  return (
    <EditorProvider
      sectionId={section.id}
      sectionTitle={section.title}
      initialScriptureOptions={scriptureOptions}
      initialFormatRecents={formatRecents}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {isOwner ? (
            <Input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              onBlur={handleTitleBlur}
              aria-label="Section title"
              className="h-auto flex-1 border-0 bg-transparent px-0 text-2xl font-bold shadow-none focus-visible:ring-0"
            />
          ) : (
            <h1 className="flex-1 text-2xl font-bold">{section.title}</h1>
          )}
          {canCompare && (
            <Link
              href={`/studies/${section.study_id}/compare/${section.id}`}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium hover:bg-muted"
            >
              <Columns2 className="size-4" />
              Compare
            </Link>
          )}
        </div>

        {/* One sticky toolbar that formats whichever editor is focused. It pins
            to the top of the page's scroll area once the title scrolls away. */}
        {isOwner ? (
          <EditorToolbar className="sticky top-0 z-20 -mx-6 border-b bg-background/95 px-6 py-2 backdrop-blur-sm" />
        ) : null}

        {/* Minimal floating menu over a text selection (portals to body). */}
        {isOwner ? <SelectionBubble /> : null}

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
