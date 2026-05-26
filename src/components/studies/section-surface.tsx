"use client";

import { Columns2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { renameSection } from "@/app/studies/actions";
import { DocumentEditor } from "@/components/studies/document-editor";
import { DocumentViewer } from "@/components/studies/document-viewer";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type {
  DocumentHistory,
  Section,
  SectionDocuments,
} from "@/lib/db/types";
import type { BlockSpec } from "@/lib/editor/blocks";

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
  defaultBlocks,
  isOwner,
  canCompare,
  me,
}: {
  section: Section;
  documents: SectionDocuments;
  notesHistory: DocumentHistory | null;
  blocksHistory: DocumentHistory | null;
  defaultBlocks: BlockSpec[];
  isOwner: boolean;
  canCompare: boolean;
  me: { id: string; name: string } | null;
}) {
  const [title, setTitle] = useState(section.title);

  function handleTitleBlur() {
    const next = title.trim() || "Untitled section";
    if (next !== section.title) {
      void renameSection(section.id, section.study_id, next);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
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

      <div className="h-96 shrink-0">
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
      </div>

      <Separator />

      <div className="h-72 shrink-0">
        {isOwner && blocksHistory ? (
          <DocumentEditor
            document={documents.blocks}
            history={blocksHistory}
            me={me}
            label="Study blocks"
            placeholder="Work through your study here…"
            defaultBlocks={defaultBlocks}
          />
        ) : (
          <DocumentViewer
            document={documents.blocks}
            me={me}
            label="Study blocks"
          />
        )}
      </div>
    </div>
  );
}
