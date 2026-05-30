"use client";

import { RotateCcw } from "lucide-react";
import type { Node } from "prosemirror-model";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  loadDeletedSectionDocuments,
  restoreSection,
} from "@/app/studies/actions";
import { DocPreview } from "@/components/studies/doc-preview";
import {
  PreviewSkeleton,
  ReviewPanelShell,
} from "@/components/studies/review-panel-shell";
import { daysLeftLabel } from "@/components/studies/trash-button";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { TrashItem } from "@/lib/db/types";
import { jsonToDoc } from "@/lib/editor/serialize";
import { cn } from "@/lib/utils";

/**
 * Full-screen "Recently deleted sections" review panel — the trash-side peer
 * of `<SectionHistoryPanel>`. Both share `<ReviewPanelShell>` for the chrome
 * (header bar with title + action + close X, fixed-width left rail, scrolling
 * right pane) so the two surfaces stay structurally identical.
 *
 * Left rail lists each trashed section with its days-left countdown. Selecting
 * a row fetches its notes + blocks documents (via `loadDeletedSectionDocuments`,
 * which RLS allows for the study owner on soft-deleted rows) and renders both
 * read-only via `<DocPreview>`. Restore runs `restoreSection`, then closes the
 * panel and navigates into the restored section so it opens in the editor.
 */
export function SectionTrashPanel({
  studyId,
  items,
  onClose,
}: {
  studyId: string;
  items: TrashItem[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(
    items[0]?.id ?? null,
  );
  const [preview, setPreview] = useState<{
    notesDoc: Node;
    blocksDoc: Node;
  } | null>(null);
  // Same pattern as section-history-panel: surface load failures so previews
  // don't silently render nothing if a stored doc fails to deserialize.
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [restorePending, startRestore] = useTransition();

  // Fetch + materialize the selected section's documents. Clears preview
  // up-front so the right pane flips to PreviewSkeleton during the round-trip
  // (feedback that something is loading after each click).
  useEffect(() => {
    if (selectedId === null) {
      return;
    }
    // Intentional setState-in-effect: this IS the synchronization with
    // `selectedId` — the rule's "update external systems" use case. Clearing
    // preview here is what triggers the skeleton to render until the fetch
    // resolves.
    /* eslint-disable react-hooks/set-state-in-effect */
    setPreview(null);
    setPreviewError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    let active = true;
    void loadDeletedSectionDocuments(selectedId, studyId)
      .then((docs) => {
        if (!active) return;
        try {
          setPreview({
            notesDoc: jsonToDoc(docs.notes),
            blocksDoc: jsonToDoc(docs.blocks),
          });
        } catch (err) {
          console.error("[SectionTrashPanel] doc deserialization failed", err);
          setPreview(null);
          setPreviewError(err instanceof Error ? err.message : String(err));
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        console.error(
          "[SectionTrashPanel] loadDeletedSectionDocuments failed",
          { selectedId, studyId },
          err,
        );
        setPreview(null);
        setPreviewError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [selectedId, studyId]);

  // If the trash empties out while the panel is open (e.g. parent revalidates
  // after a restore), self-close so we're not left framing an empty list.
  useEffect(() => {
    if (items.length === 0) {
      onClose();
    }
  }, [items.length, onClose]);

  function handleRestore() {
    if (selectedId === null) {
      return;
    }
    const idToRestore = selectedId;
    startRestore(() => {
      void restoreSection(idToRestore, studyId).then(() => {
        toast.success("Section restored.");
        onClose();
        router.push(`/studies/${studyId}/${idToRestore}`);
      });
    });
  }

  const action = (
    <Button
      type="button"
      size="sm"
      disabled={selectedId === null || restorePending}
      onClick={handleRestore}
    >
      <RotateCcw className="size-4" />
      Restore this section
    </Button>
  );

  const aside = (
    <>
      <div className="border-b px-4 py-3 text-caption font-medium tracking-wide text-muted-foreground uppercase">
        Deleted sections
      </div>
      <div className="flex-1 overflow-auto p-1">
        <ul className="space-y-0.5">
          {items.map((item) => {
            const selected = selectedId === item.id;
            const hasTitle = item.title.trim() !== "";
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(item.id);
                  }}
                  aria-pressed={selected}
                  className={cn(
                    "w-full rounded-md px-3 py-2 text-left",
                    selected
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  <div className="truncate text-ui font-medium">
                    {hasTitle ? (
                      item.title
                    ) : (
                      <span className="italic opacity-70">New Section</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-caption text-muted-foreground">
                    {daysLeftLabel(item.deleted_at)}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );

  return (
    <ReviewPanelShell
      titleId="section-trash-title"
      title="Recently deleted sections"
      action={action}
      onClose={onClose}
      aside={aside}
    >
      {previewError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-caption text-destructive">
          <p className="font-medium">Couldn&apos;t load this section.</p>
          <p className="mt-2 font-mono text-caption break-all text-muted-foreground">
            {previewError}
          </p>
        </div>
      ) : null}
      <section className="space-y-2">
        <span className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
          Study Body
        </span>
        {preview ? (
          <DocPreview doc={preview.notesDoc} />
        ) : previewError ? null : (
          <PreviewSkeleton />
        )}
      </section>
      <Separator />
      <section className="space-y-2">
        <span className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
          Study blocks
        </span>
        {preview ? (
          <DocPreview doc={preview.blocksDoc} />
        ) : previewError ? null : (
          <PreviewSkeleton />
        )}
      </section>
    </ReviewPanelShell>
  );
}
