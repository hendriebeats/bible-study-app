/**
 * Groups a section's fine-grained version-history "moments" (one per ~1.2s
 * autosave batch) into coarse editing **sessions** for display, so the history
 * panel reads like Google Docs' version list rather than a dense per-keystroke
 * scrubber. Pure and stateless — a presentation layer over the existing merged
 * moment list; no schema or query changes.
 */

/** A gap longer than this between consecutive moments starts a new session.
 * 20 minutes — long enough that a coffee break or scripture-lookup pause
 * stays inside one session, short enough that distinct sittings (lunch
 * break, end-of-day return) cleanly separate into their own rows. */
export const SESSION_GAP_MS = 20 * 60 * 1000;

export interface HistoryMoment {
  /** ISO timestamp of this save-batch. */
  iso: string;
  /** Position in the flat, ascending merged-moments array (stable UI id). */
  index: number;
}

export interface HistorySession {
  startIso: string;
  endIso: string;
  /** Flat index of the first moment in this session. */
  startIndex: number;
  /** Flat index of the last (latest) moment in this session. */
  endIndex: number;
  moments: HistoryMoment[];
  /** Human label, e.g. "May 27, 2026, 3:45 PM · 12 min". */
  label: string;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** "May 27, 2026, 3:45 PM" for a single moment, with a "· N min" duration when
 * the session spans time. */
export function formatSessionLabel(startIso: string, endIso: string): string {
  const start = formatTimestamp(startIso);
  const ms = Date.parse(endIso) - Date.parse(startIso);
  if (!(ms > 0)) {
    return start; // single-moment session (or unparseable) → bare timestamp
  }
  const minutes = Math.round(ms / 60000);
  return minutes < 1
    ? `${start} · <1 min`
    : `${start} · ${String(minutes)} min`;
}

/**
 * Cluster ascending, de-duplicated moment timestamps into editing sessions: a
 * gap larger than `gapMs` between consecutive moments starts a new session. Each
 * moment keeps its flat `index` so the panel's existing index-based
 * reconstruction/restore keeps working unchanged.
 */
export function groupMomentsIntoSessions(
  moments: string[],
  gapMs: number = SESSION_GAP_MS,
): HistorySession[] {
  const sessions: HistorySession[] = [];
  let bucket: HistoryMoment[] = [];

  const flush = () => {
    const first = bucket[0];
    const last = bucket[bucket.length - 1];
    if (!first || !last) {
      return;
    }
    sessions.push({
      startIso: first.iso,
      endIso: last.iso,
      startIndex: first.index,
      endIndex: last.index,
      moments: bucket,
      label: formatSessionLabel(first.iso, last.iso),
    });
    bucket = [];
  };

  for (const [index, iso] of moments.entries()) {
    const prev = bucket[bucket.length - 1];
    if (prev && Date.parse(iso) - Date.parse(prev.iso) > gapMs) {
      flush();
    }
    bucket.push({ iso, index });
  }
  flush();
  return sessions;
}
