"use client";

import { RotateCcw, X } from "lucide-react";
import type { Node } from "prosemirror-model";
import { useEffect, useMemo, useState } from "react";

import {
  fetchDocumentMoments,
  reconstructDocumentVersion,
} from "@/app/studies/actions";
import { DocPreview } from "@/components/studies/doc-preview";
import { useEditorContext } from "@/components/studies/editor-context";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import type { DocumentStepMeta } from "@/lib/db/types";
import { groupMomentsIntoSessions } from "@/lib/editor/history-sessions";
import { jsonToDoc } from "@/lib/editor/serialize";
import { cn } from "@/lib/utils";

/** Debounce before materializing a scrubbed-to point (keeps dragging smooth). */
const PREVIEW_DEBOUNCE_MS = 180;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** The version a document was at by time `iso` (its last step at or before it). */
function versionAt(steps: DocumentStepMeta[], iso: string): number {
  let version = 0;
  for (const step of steps) {
    if (step.created_at <= iso) {
      version = step.version;
    }
  }
  return version;
}

/** The document's current head version (its last step's version, or 0). */
function headVersion(steps: DocumentStepMeta[]): number {
  const last = steps[steps.length - 1];
  return last ? last.version : 0;
}

/**
 * One shared version history for a section's two documents (Study Body + Study
 * blocks). The two per-document step-logs are merged into a single timeline by
 * timestamp; scrubbing to a moment reconstructs BOTH documents as they were then
 * and previews them together, and Restore rolls both back at once.
 *
 * Loads only lightweight step metadata up front (so it opens fast regardless of
 * how long the history is) and materializes the scrubbed-to point on demand with
 * a bounded server query — see `fetchDocumentStepsMeta` /
 * `reconstructDocumentVersion`.
 */
export function SectionHistoryPanel({
  notesId,
  blocksId,
  onClose,
}: {
  notesId: string;
  blocksId: string;
  onClose: () => void;
}) {
  const ctx = useEditorContext();
  const [notesSteps, setNotesSteps] = useState<DocumentStepMeta[] | null>(null);
  const [blocksSteps, setBlocksSteps] = useState<DocumentStepMeta[] | null>(
    null,
  );
  // Index into the merged moments; the last index is "now" (current head).
  const [index, setIndex] = useState<number | null>(null);
  // Which editing session is expanded; null defaults to the most recent.
  const [sessionIdx, setSessionIdx] = useState<number | null>(null);
  const [preview, setPreview] = useState<{
    notesDoc: Node;
    blocksDoc: Node;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetchDocumentMoments(notesId),
      fetchDocumentMoments(blocksId),
    ]).then(([n, b]) => {
      if (active) {
        setNotesSteps(n);
        setBlocksSteps(b);
      }
    });
    return () => {
      active = false;
    };
  }, [notesId, blocksId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  // Merged, de-duplicated timestamps across both documents' steps, ascending.
  const moments = useMemo(() => {
    if (!notesSteps || !blocksSteps) {
      return [];
    }
    const times = new Set<string>();
    for (const step of notesSteps) times.add(step.created_at);
    for (const step of blocksSteps) times.add(step.created_at);
    return Array.from(times).sort();
  }, [notesSteps, blocksSteps]);

  const maxIndex = moments.length; // final index = "now"
  const current = index ?? maxIndex;
  const atHead = current >= maxIndex;
  const currentIso = atHead ? null : (moments[current] ?? null);

  // Cluster the dense per-save moments into coarse editing sessions for display.
  const sessions = useMemo(() => groupMomentsIntoSessions(moments), [moments]);
  // Default to the most recent session so the panel opens on recent work.
  const selectedIdx =
    sessionIdx ?? (sessions.length > 0 ? sessions.length - 1 : 0);
  const session = sessions[selectedIdx] ?? null;
  const isLastSession = selectedIdx === sessions.length - 1;
  // Scrub within the selected session only; the most recent one extends to "now".
  const sliderMin = session ? session.startIndex : 0;
  const sliderMax = session
    ? isLastSession
      ? maxIndex
      : session.endIndex
    : maxIndex;
  const showSlider = sliderMax > sliderMin;
  const sliderValue = Math.min(Math.max(current, sliderMin), sliderMax);

  // Jump to a session's latest point (the head itself for the most recent one).
  function selectSession(i: number) {
    const picked = sessions[i];
    if (!picked) {
      return;
    }
    setSessionIdx(i);
    setIndex(i === sessions.length - 1 ? maxIndex : picked.endIndex);
  }

  // Materialize both documents at the selected moment (debounced, on demand).
  useEffect(() => {
    if (!notesSteps || !blocksSteps) {
      return;
    }
    const notesV =
      currentIso === null
        ? headVersion(notesSteps)
        : versionAt(notesSteps, currentIso);
    const blocksV =
      currentIso === null
        ? headVersion(blocksSteps)
        : versionAt(blocksSteps, currentIso);
    let active = true;
    const timer = setTimeout(() => {
      void Promise.all([
        reconstructDocumentVersion(notesId, notesV),
        reconstructDocumentVersion(blocksId, blocksV),
      ]).then(([n, b]) => {
        if (active) {
          setPreview({ notesDoc: jsonToDoc(n), blocksDoc: jsonToDoc(b) });
        }
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [notesSteps, blocksSteps, currentIso, notesId, blocksId]);

  async function handleRestore() {
    if (!ctx || !notesSteps || !blocksSteps || currentIso === null) {
      return;
    }
    // Reconstruct fresh at the selected moment (don't trust the async preview,
    // which may still be catching up to the slider).
    const [notesDoc, blocksDoc] = await Promise.all([
      reconstructDocumentVersion(notesId, versionAt(notesSteps, currentIso)),
      reconstructDocumentVersion(blocksId, versionAt(blocksSteps, currentIso)),
    ]);
    ctx.restoreSection(notesDoc, blocksDoc);
    onClose();
  }

  const loading = !notesSteps || !blocksSteps;
  const empty = !loading && moments.length === 0;

  return (
    <>
      <button
        type="button"
        aria-label="Close version history"
        className="fixed inset-0 z-40 bg-foreground/20 motion-safe:animate-in motion-safe:fade-in"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-card shadow-lg motion-safe:animate-in motion-safe:slide-in-from-right sm:w-96">
        <header className="flex items-center justify-between p-4">
          <span className="font-semibold">Section history</span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </header>
        <Separator />

        {loading || empty ? (
          <p className="p-4 text-sm text-muted-foreground">
            {loading ? "Loading…" : "No saved history yet."}
          </p>
        ) : (
          <>
            <div className="max-h-48 space-y-1 overflow-auto p-2">
              {sessions.map((s, i) => (
                <button
                  key={s.startIso}
                  type="button"
                  onClick={() => {
                    selectSession(i);
                  }}
                  aria-pressed={i === selectedIdx}
                  className={cn(
                    "w-full rounded-md px-3 py-2 text-left text-sm",
                    i === selectedIdx
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <Separator />

            <div className="space-y-3 p-4">
              {showSlider ? (
                <Slider
                  min={sliderMin}
                  max={sliderMax}
                  step={1}
                  value={[sliderValue]}
                  onValueChange={(values) => {
                    setIndex(values[0] ?? sliderMax);
                  }}
                  aria-label="Point in time within session"
                />
              ) : null}
              <span className="text-xs text-muted-foreground">
                {currentIso === null
                  ? "Now (latest)"
                  : `As of ${formatTime(currentIso)}`}
              </span>
            </div>
            <Separator />

            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
              <div className="space-y-2">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Study Body
                </span>
                {preview ? <DocPreview doc={preview.notesDoc} /> : null}
              </div>
              <Separator />
              <div className="space-y-2">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Study blocks
                </span>
                {preview ? <DocPreview doc={preview.blocksDoc} /> : null}
              </div>
            </div>
            <Separator />

            <div className="p-4">
              <Button
                type="button"
                className="w-full"
                disabled={atHead}
                onClick={() => {
                  void handleRestore();
                }}
              >
                <RotateCcw className="size-4" />
                Restore this point
              </Button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
