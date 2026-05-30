"use client";

import { RotateCcw } from "lucide-react";
import type { Node } from "prosemirror-model";
import { useEffect, useMemo, useState } from "react";

import {
  fetchDocumentMoments,
  reconstructDocumentVersion,
} from "@/app/studies/actions";
import { DocPreview } from "@/components/studies/doc-preview";
import { useEditorContext } from "@/components/studies/editor-context";
import {
  PreviewSkeleton,
  ReviewPanelShell,
} from "@/components/studies/review-panel-shell";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { DocumentStepMeta } from "@/lib/db/types";
import {
  type HistoryMoment,
  groupMomentsIntoSessions,
} from "@/lib/editor/history-sessions";
import { resurrectTrashedImages } from "@/lib/editor/image-resurrect";
import { jsonToDoc } from "@/lib/editor/serialize";
import { cn } from "@/lib/utils";

/** Debounce before materializing a scrubbed-to point (keeps clicks snappy). */
const PREVIEW_DEBOUNCE_MS = 180;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Time-of-day at minute granularity (e.g. "6:30 PM") for the per-minute
 * sub-rows inside an accordion-expanded session. The session header already
 * carries the date, so these only disambiguate within an editing burst. */
function formatMomentTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Stable per-local-minute key for grouping. Uses Date methods (not ISO
 * substring) so the boundaries align with the user's local clock — UTC
 * minute slicing would split or fuse minutes inconsistently across DST or
 * non-zero UTC offsets. */
function localMinuteKey(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getFullYear())}-${String(d.getMonth())}-${String(
    d.getDate(),
  )}-${String(d.getHours())}-${String(d.getMinutes())}`;
}

/**
 * Collapse a session's fine-grained moments to one entry per local minute,
 * keeping the EARLIEST moment of each minute as the representative (its
 * `index` is what we'll restore/scrub to). Input is already ascending by
 * timestamp, so the first time we see a minute key is the earliest. Returns
 * the reduced list in ascending order.
 */
function groupMomentsByMinute(moments: HistoryMoment[]): HistoryMoment[] {
  const byMinute = new Map<string, HistoryMoment>();
  for (const moment of moments) {
    const key = localMinuteKey(moment.iso);
    if (!byMinute.has(key)) {
      byMinute.set(key, moment);
    }
  }
  return Array.from(byMinute.values());
}

/**
 * The version a document was at by time `iso` — its last step at or before it.
 * Requires `steps` to be ASCENDING by `created_at` so that overwriting `version`
 * on each match yields the latest one. `fetchDocumentMoments` guarantees that
 * order; flipping the order here would silently re-introduce the "preview
 * stuck on the earliest version" scrub bug.
 */
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
 * One shared version history for a section's two documents (Study Body +
 * Study blocks). The two per-document step-logs are merged into a single
 * timeline by timestamp; picking a moment reconstructs BOTH documents as
 * they were then and previews them together, and Restore rolls both back
 * at once via `ctx.restoreSection`. See [[section-shared-history]].
 *
 * UX shape (v3): a pinned "Now (latest)" row + an accordion of editing
 * sessions in the left sidebar; expanding a session reveals its individual
 * moments as clickable rows. The right pane shows skeleton previews while a
 * reconstruct round-trip is in flight, then the materialized past docs.
 * Restore lives in the top-right of the header.
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
  // Index into the merged moments; null means "Now (latest)".
  const [index, setIndex] = useState<number | null>(null);
  // Which editing session is expanded in the accordion; null = collapsed.
  // Initialized to the latest session once `sessions` arrives (see effect).
  const [sessionIdx, setSessionIdx] = useState<number | null>(null);
  const [preview, setPreview] = useState<{
    notesDoc: Node;
    blocksDoc: Node;
  } | null>(null);
  // Surface reconstruct failures (legacy step replay can fail under the
  // current schema). Without this the previews would silently render nothing.
  const [previewError, setPreviewError] = useState<string | null>(null);

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

  // Escape-to-close is handled by `<ReviewPanelShell>`.

  // Merged, de-duplicated timestamps across both documents' steps, ascending —
  // one "moment" = one timestamp that exists in at least one of the two logs.
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

  // Cluster the dense per-word moments into coarse editing sessions for display.
  const sessions = useMemo(() => groupMomentsIntoSessions(moments), [moments]);

  // Default-expand the latest session once `sessions` is populated. We only
  // initialize when the user hasn't already touched the accordion (sessionIdx
  // still null), so collapse/expand interactions aren't fought by this effect.
  useEffect(() => {
    if (sessionIdx === null && sessions.length > 0) {
      // Intentional setState-in-effect: this is exactly the "react to a derived
      // value transitioning from 0 → N on first load" case. We deliberately
      // don't depend on `sessionIdx` so toggling collapse to null later isn't
      // overridden by this effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessionIdx(sessions.length - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length]);

  function selectNow() {
    setIndex(null);
  }

  // Materialize both documents at the selected moment (debounced, on demand).
  // Clears `preview` to null up-front so the right pane flips to PreviewSkeleton
  // for the round-trip — feedback that something is loading after each click.
  useEffect(() => {
    if (!notesSteps || !blocksSteps) {
      return;
    }
    // Intentional setState-in-effect: clears the preview pane the moment the
    // user clicks a new moment, so the right side flips to PreviewSkeleton for
    // the round-trip rather than showing stale content while reconstruction
    // runs. This IS the synchronization with the (notesSteps, blocksSteps,
    // currentIso) tuple — the rule's "update external systems" use case.
    /* eslint-disable react-hooks/set-state-in-effect */
    setPreview(null);
    setPreviewError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
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
      ])
        .then(([n, b]) => {
          if (!active) return;
          try {
            setPreview({ notesDoc: jsonToDoc(n), blocksDoc: jsonToDoc(b) });
            setPreviewError(null);
          } catch (err) {
            // jsonToDoc throws when stored content doesn't validate against
            // the current schema (a real, user-visible problem with this
            // section's history, not a transient glitch).
            console.error(
              "[SectionHistoryPanel] doc deserialization failed",
              err,
            );
            setPreview(null);
            setPreviewError(err instanceof Error ? err.message : String(err));
          }
        })
        .catch((err: unknown) => {
          if (!active) return;
          console.error(
            "[SectionHistoryPanel] reconstructDocumentVersion failed",
            { notesV, blocksV, notesId, blocksId },
            err,
          );
          setPreview(null);
          setPreviewError(err instanceof Error ? err.message : String(err));
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
    // which may still be catching up to the click).
    const [notesDoc, blocksDoc] = await Promise.all([
      reconstructDocumentVersion(notesId, versionAt(notesSteps, currentIso)),
      reconstructDocumentVersion(blocksId, versionAt(blocksSteps, currentIso)),
    ]);
    // Resurrect any image files the per-save cleanup soft-deleted since this
    // snapshot was taken (move `_trash/...` → live path). Best-effort: files
    // already hard-deleted past the 30-day window will render as the broken
    // placeholder in the restored doc. Don't block on errors.
    try {
      await resurrectTrashedImages([notesDoc, blocksDoc]);
    } catch (e) {
      console.warn("[SectionHistoryPanel] image resurrect failed", e);
    }
    ctx.restoreSection(notesDoc, blocksDoc);
    onClose();
  }

  const loading = !notesSteps || !blocksSteps;
  const empty = !loading && moments.length === 0;

  const action = (
    <Button
      type="button"
      size="sm"
      disabled={atHead}
      onClick={() => {
        void handleRestore();
      }}
    >
      <RotateCcw className="size-4" />
      Restore this version
    </Button>
  );

  // Pinned "Now" + accordion of sessions, plus the "As of …" footer.
  const aside = (
    <>
      <div className="border-b p-2">
        <button
          type="button"
          onClick={selectNow}
          aria-pressed={atHead}
          className={cn(
            "w-full rounded-md px-3 py-2 text-left text-ui font-medium",
            atHead ? "bg-accent text-accent-foreground" : "hover:bg-muted",
          )}
        >
          Now (latest)
        </button>
      </div>
      <div className="flex-1 overflow-auto p-1">
        <Accordion
          type="single"
          collapsible
          value={sessionIdx !== null ? String(sessionIdx) : undefined}
          onValueChange={(value) => {
            if (value === "") {
              // Collapsing — leave the moment selection alone so a subsequent
              // re-expand returns the user where they were.
              setSessionIdx(null);
              return;
            }
            // Expanding via user click — jump the preview to this session's
            // FIRST moment (the earliest row the user is about to see in the
            // per-minute grouped sub-list, which by construction is the
            // session's earliest moment). Only fires on user interaction; the
            // initial auto-expand of the latest session updates `value`
            // declaratively and doesn't trigger this handler, so we keep "Now"
            // as the panel's default on open.
            const nextSessionIdx = Number(value);
            setSessionIdx(nextSessionIdx);
            const firstMoment = sessions[nextSessionIdx]?.moments[0];
            if (firstMoment) {
              setIndex(firstMoment.index);
            }
          }}
        >
          {sessions.map((s, i) => (
            <AccordionItem key={s.startIso} value={String(i)}>
              <AccordionTrigger>{s.label}</AccordionTrigger>
              <AccordionContent>
                <ul className="space-y-0.5 pl-2">
                  {groupMomentsByMinute(s.moments).map((m) => {
                    const selected = !atHead && current === m.index;
                    return (
                      <li key={m.iso}>
                        <button
                          type="button"
                          onClick={() => {
                            setIndex(m.index);
                          }}
                          aria-pressed={selected}
                          className={cn(
                            "w-full rounded-md px-3 py-1.5 text-left text-caption",
                            selected
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-muted",
                          )}
                        >
                          {formatMomentTime(m.iso)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
      <Separator />
      <div className="px-4 py-3 text-caption text-muted-foreground">
        {currentIso === null
          ? "Now (latest)"
          : `As of ${formatTime(currentIso)}`}
      </div>
    </>
  );

  return (
    <ReviewPanelShell
      titleId="section-history-title"
      title="Version history"
      action={action}
      onClose={onClose}
      aside={aside}
      emptyState={
        loading || empty ? (
          <p className="p-6 text-caption text-muted-foreground">
            {loading ? "Loading…" : "No saved history yet."}
          </p>
        ) : undefined
      }
    >
      {previewError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-caption text-destructive">
          <p className="font-medium">Couldn&apos;t reconstruct this version.</p>
          <p className="mt-1 text-muted-foreground">
            Most likely an older step in this section&apos;s history references
            a node type the editor no longer recognizes (the flat-schema
            rewrite). The current document is safe — only the preview at this
            point in time failed.
          </p>
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
