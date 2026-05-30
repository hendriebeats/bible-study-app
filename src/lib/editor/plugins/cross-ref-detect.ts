/**
 * Auto-detect cross-references — gated on the `crossRefAutoDetect` editor tool.
 *
 * As the user types, this plugin finds the longest valid scripture reference
 * ending at the cursor (via {@link findReferenceEndingAt}) and wraps it with
 * an "uncommitted" `crossRef` mark that grows/contracts each transaction. When
 * the user moves on (cursor leaves the marked range OR types a terminator),
 * the chip is "committed": the underlying text is rewritten to the canonical
 * form (`jhn 3:16` → `John 3:16`) and the mark flips `committed: true`. If the
 * user later clicks back inside a committed chip, it reverts to uncommitted so
 * the detector can re-run and the chip can grow/shrink with their edits.
 *
 * Single-click on a chip dispatches a window event so the popover bridge can
 * render the preview. Double-click opens BibleHub in a new tab — same gesture
 * the existing `verse_number` atom uses.
 *
 * Exclusions: code blocks, the inline `code` mark, the `notes_index` (and any
 * descendant `note_entry`), and any range already inside a committed `crossRef`
 * (marks don't nest). Scripture blocks are NOT excluded — a quoted ref inside
 * inserted ESV text should chip like anywhere else.
 *
 * The plugin tags its own transactions with `meta("crossRefDetect", true)` so
 * `appendTransaction` won't loop on its own edits.
 */

import type { Mark, Node as PMNode, ResolvedPos } from "prosemirror-model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { bibleGatewayUrl } from "@/lib/scripture/biblegateway";
import { BOOKS } from "@/lib/scripture/books";
import {
  canonicalReferenceText,
  findAllReferences,
  findReferenceEndingAt,
  type ReferenceMatch,
} from "@/lib/scripture/progressive-reference";
import type { ParsedReference } from "@/lib/scripture/reference";

import type { EditorTools } from "../editor-tools";
import { marks } from "../schema";

const KEY = new PluginKey("crossRefDetect");
const META = "crossRefDetect";

/** Window event the popover bridge subscribes to. */
export const CROSS_REF_OPEN_EVENT = "pm-open-cross-ref";

export interface CrossRefAttrs {
  book: number;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
  raw: string;
  committed: boolean;
}

export interface CrossRefOpenEventDetail {
  attrs: CrossRefAttrs;
  /** Screen rect of the chip element the user clicked. */
  anchorRect: { left: number; top: number; right: number; bottom: number };
}

interface RangeRef {
  from: number;
  to: number;
  mark: Mark;
}

/** Build the constructor that the editor surfaces register in their plugin list. */
export function crossRefDetect(tools: EditorTools): Plugin {
  if (!tools.crossRefAutoDetect) {
    // Still attach click/double-click handlers so EXISTING chips in the doc
    // (persisted from a prior session when the tool was on) keep their
    // preview / BibleHub affordances. Detection itself is the no-op.
    return interactionOnlyPlugin();
  }

  return new Plugin({
    key: KEY,
    props: {
      handleDOMEvents: {
        // mousedown runs BEFORE the browser places the caret on the click. We
        // swallow the default action so a plain left-click on a chip keeps the
        // caret exactly where the user left it — the chip behaves like a
        // button, not a hyperlink. The follow-up `click` opens the popover.
        mousedown: (view, event) => handleMouseDown(view, event),
        click: (view, event) => handleClick(view, event),
        dblclick: (_view, event) => handleDoubleClick(event),
      },
    },
    appendTransaction: (transactions, _oldState, newState) => {
      // Skip our own transactions (avoid loops) and pure cursor selections
      // that didn't actually change the doc *and* didn't move the head.
      if (transactions.every((tr) => tr.getMeta(META))) return null;
      const anyDocChange = transactions.some((tr) => tr.docChanged);
      const anySelChange = transactions.some(
        (tr) => tr.selectionSet || tr.docChanged,
      );
      if (!anyDocChange && !anySelChange) return null;

      // Paste pass: if any transaction was a paste-shaped doc replacement,
      // scan the affected range for fresh references too.
      const tr = newState.tr;
      let modified = false;
      modified = applyPasteScan(tr, transactions, newState) || modified;

      // Per-cursor live detection + commit pass.
      modified = applyLiveDetection(tr, newState) || modified;

      if (!modified) return null;
      tr.setMeta(META, true);
      // Don't push spurious history entries for the mark/commit bookkeeping.
      tr.setMeta("addToHistory", false);
      return tr;
    },
  });
}

/** No-op detector that still wires click/dblclick for existing chips. */
function interactionOnlyPlugin(): Plugin {
  return new Plugin({
    key: KEY,
    props: {
      handleDOMEvents: {
        click: (view, event) => handleClick(view, event),
        dblclick: (_view, event) => handleDoubleClick(event),
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Exclusion check
// ---------------------------------------------------------------------------

/**
 * True if `$pos` is somewhere detection should NEVER touch: code blocks,
 * inline `code` mark territory, the notes-index structural nodes, or already
 * inside a committed crossRef chip (marks can't nest themselves cleanly).
 */
function isExcluded($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    const t = $pos.node(d).type.name;
    if (t === "code_block" || t === "notes_index" || t === "note_entry") {
      return true;
    }
  }
  const inlineMarks = $pos.marks();
  for (const m of inlineMarks) {
    if (m.type === marks.code) return true;
    if (m.type === marks.crossRef && m.attrs.committed) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Live detection + commit pass
// ---------------------------------------------------------------------------

function applyLiveDetection(tr: Transaction, state: EditorState): boolean {
  const sel = state.selection;
  const caret = sel.empty && sel.$head.parent.isTextblock ? sel.$head : null;

  // Reconcile the cursor's textblock first (live detection + commit on run-exit),
  // then walk every other textblock and commit any orphaned uncommitted chips —
  // an uncommitted chip outside the cursor's textblock is always an orphan, no
  // matter the selection state.
  let modified = false;
  if (caret) {
    modified = reconcileTextblock(tr, state, caret) || modified;
  }

  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (caret) {
      const blockStart = pos + 1;
      const blockEnd = blockStart + node.content.size;
      if (caret.pos >= blockStart && caret.pos <= blockEnd) return false;
    }
    const $p = state.doc.resolve(pos + 1);
    modified = commitOrphans(tr, $p) || modified;
    return false;
  });
  return modified;
}

/**
 * Chars allowed inside a "ref-shape run". Letters, digits, and the punctuation
 * a single reference uses internally (`:`, `-`/en/em dashes, `.`). Note: spaces
 * are NOT in this set — they're handled separately because a space inside a
 * reference is only valid between the book name and the chapter number.
 */
const REF_RUN_CHAR = /[A-Za-z0-9:.\-–—]/;
const IS_LETTER = /[A-Za-z]/;
const IS_DIGIT = /[0-9]/;

/**
 * Snapshot one textblock's inline content as an offset-indexed array of
 * single-character strings. Atoms and other non-text inline nodes become
 * sentinel `""` entries that always break the ref-shape run. Indices
 * line up 1:1 with the parent's content offsets, so adding `parentStart` to an
 * index yields a doc position.
 */
function parentChars(parent: PMNode): string[] {
  const chars: string[] = [];
  parent.forEach((child) => {
    if (child.isText) {
      const text = child.text ?? "";
      for (const ch of text) chars.push(ch);
    } else {
      for (let i = 0; i < child.nodeSize; i++) chars.push("");
    }
  });
  return chars;
}

/**
 * Compute the maximal ref-shape run around `centerOffset` in `parent`.
 *
 * The run extends through any REF_RUN_CHAR. Spaces and commas are tolerated
 * only in narrow, reference-shaped contexts:
 *
 *   - a single internal space between a letter (book name's last char) and
 *     a digit (chapter number's first char) — the canonical "Book Chapter"
 *     separator
 *   - a `,` between digits (optionally surrounded by spaces) — the
 *     comma-list verse form `John 3:16, 18`
 *
 * Anything else (newline, double space, sentence punctuation) ends the run.
 *
 * The cursor sits "inside" the run as long as it's between `start` and `end`
 * (inclusive). When the cursor leaves this window — i.e., the user typed a
 * true terminator — the chip can be committed.
 */
function runAround(
  $p: ResolvedPos,
  centerOffset: number,
): { start: number; end: number } {
  const chars = parentChars($p.parent);
  const parentStart = $p.start();
  const size = chars.length;

  const at = (i: number): string | null => {
    if (i < 0 || i >= size) return null;
    return chars[i] ?? null;
  };
  const isRefChar = (ch: string | null): boolean =>
    ch !== null && REF_RUN_CHAR.test(ch);

  /**
   * Looking outward in `dir` (+1 forward, -1 backward) from `i`, skip up to
   * one space and return whether the next non-space char is a digit. Used to
   * check the comma-and-space-and-digit comma-list extension on both sides.
   */
  const nextNonSpaceIsDigit = (i: number, dir: 1 | -1): boolean => {
    let j = i;
    if (at(j) === " ") j += dir;
    const ch = at(j);
    return ch !== null && IS_DIGIT.test(ch);
  };

  // Walk backward
  let start = Math.max(0, Math.min(centerOffset, size));
  while (start > 0) {
    const prev = at(start - 1);
    if (prev === null) break;
    if (isRefChar(prev)) {
      start--;
      continue;
    }
    if (prev === " ") {
      const before = at(start - 2);
      const after = at(start);
      // Book↔Chapter space.
      if (
        before !== null &&
        IS_LETTER.test(before) &&
        after !== null &&
        IS_DIGIT.test(after)
      ) {
        start--;
        continue;
      }
      // Space between a comma and a digit (e.g. `16, 18` walking back from
      // after "18" past the space to ",").
      if (
        (before === "," && after !== null && IS_DIGIT.test(after)) ||
        (after === "," && before !== null && IS_DIGIT.test(before))
      ) {
        start--;
        continue;
      }
    }
    if (prev === ",") {
      // Allow the comma if it sits between digits (with optional spaces).
      const beforeDigit = nextNonSpaceIsDigit(start - 2, -1);
      const afterDigit = nextNonSpaceIsDigit(start, 1);
      if (beforeDigit && afterDigit) {
        start--;
        continue;
      }
    }
    break;
  }

  // Walk forward
  let end = Math.max(0, Math.min(centerOffset, size));
  while (end < size) {
    const next = at(end);
    if (next === null) break;
    if (isRefChar(next)) {
      end++;
      continue;
    }
    if (next === " ") {
      const before = at(end - 1);
      const after = at(end + 1);
      // Book↔Chapter space.
      if (
        before !== null &&
        IS_LETTER.test(before) &&
        after !== null &&
        IS_DIGIT.test(after)
      ) {
        end++;
        continue;
      }
      // Space around a comma in a digit context.
      if (
        (before === "," && after !== null && IS_DIGIT.test(after)) ||
        (after === "," && before !== null && IS_DIGIT.test(before))
      ) {
        end++;
        continue;
      }
    }
    if (next === ",") {
      const beforeDigit = nextNonSpaceIsDigit(end - 1, -1);
      const afterDigit = nextNonSpaceIsDigit(end + 1, 1);
      if (beforeDigit && afterDigit) {
        end++;
        continue;
      }
    }
    break;
  }

  return { start: parentStart + start, end: parentStart + end };
}

function reconcileTextblock(
  tr: Transaction,
  state: EditorState,
  $cursor: ResolvedPos,
): boolean {
  let modified = false;

  // Collect all crossRef ranges in this textblock.
  const ranges = collectCrossRefRanges($cursor);
  const cursorPos = $cursor.pos;
  const cursorOffset = $cursor.parentOffset;

  // Pre-compute the ref-shape run at the cursor — used both to decide when
  // each existing chip should commit and to drive the live re-detection.
  const cursorRun = runAround($cursor, cursorOffset);

  // Pass A: every existing chip. "Cursor inside the chip's run" keeps it
  // editable; "cursor outside" commits it (uncommitted → committed) or leaves
  // it alone (already committed).
  for (const r of ranges) {
    const committed = Boolean(r.mark.attrs.committed);
    const chipStartOffset = r.from - $cursor.start();
    const chipRun = runAround($cursor, chipStartOffset);
    // The chip's run and the cursor's run are the same contiguous block when
    // they overlap, so checking either gives the same answer. Use the chip's.
    const cursorInChipRun =
      cursorPos >= chipRun.start && cursorPos <= chipRun.end;

    if (!committed && !cursorInChipRun) {
      // The user moved on. Rewrite to canonical form and commit.
      const from = tr.mapping.map(r.from);
      const to = tr.mapping.map(r.to);
      const canonical = canonicalReferenceText(parsedFromMark(r.mark));
      const existingText = tr.doc.textBetween(from, to, "", "");
      const committedMark = marks.crossRef.create({
        ...r.mark.attrs,
        raw: canonical,
        committed: true,
      });
      if (existingText !== canonical) {
        tr.replaceWith(from, to, state.schema.text(canonical, [committedMark]));
      } else {
        tr.removeMark(from, to, marks.crossRef);
        tr.addMark(from, to, committedMark);
      }
      modified = true;
    } else if (committed && !cursorInChipRun) {
      // Re-validate a committed pill the user is no longer touching. If the
      // text inside it no longer parses (e.g. they typed garbage mid-edit
      // then moved on), drop the mark so a broken pill doesn't keep linking
      // to a stale verse.
      const from = tr.mapping.map(r.from);
      const to = tr.mapping.map(r.to);
      const chipText = tr.doc.textBetween(from, to, "", "");
      const reparsed = findReferenceEndingAt(chipText);
      if (reparsed?.start !== 0 || reparsed.end !== chipText.length) {
        tr.removeMark(from, to, marks.crossRef);
        modified = true;
      }
    }
    // (committed && cursorInChipRun): leave the pill visible. Pass B will
    // update its attrs/range as the user edits — `committed: true` is
    // preserved so the pill doesn't flicker off.
  }

  // Pass B: live re-detection within the cursor's ref-shape run.
  if (!isExcluded($cursor) && cursorRun.start < cursorRun.end) {
    const runText = state.doc.textBetween(
      cursorRun.start,
      cursorRun.end,
      "",
      "",
    );
    const match = findReferenceEndingAt(runText);
    const matchFrom = match ? cursorRun.start + match.start : null;
    const matchTo = match ? cursorRun.start + match.end : null;

    // Any uncommitted chip that overlaps the cursor's run is the live candidate
    // we'd be replacing.
    const existingLive = ranges.find((r) => {
      const overlapsRun = r.to > cursorRun.start && r.from < cursorRun.end;
      return overlapsRun;
    });

    const existingCommitted = existingLive
      ? Boolean(existingLive.mark.attrs.committed)
      : false;

    if (match && matchFrom !== null && matchTo !== null) {
      const newAttrs: CrossRefAttrs = {
        book: match.parsed.bookOrdinal,
        startChapter: match.parsed.startChapter,
        startVerse: match.parsed.startVerse,
        endChapter: match.parsed.endChapter,
        endVerse: match.parsed.endVerse,
        raw: runText.slice(match.start, match.end),
        // Preserve the visual state. A NEW match (no existing chip in run)
        // starts uncommitted → invisible; the pill appears only after Pass
        // A commits it on the next cursor-exit. A live edit inside an
        // already-committed pill keeps committed=true so the pill stays.
        committed: existingCommitted,
      };
      const existingFrom = existingLive
        ? tr.mapping.map(existingLive.from)
        : null;
      const existingTo = existingLive ? tr.mapping.map(existingLive.to) : null;
      const sameRange = existingFrom === matchFrom && existingTo === matchTo;
      const attrsMatch =
        existingLive !== undefined &&
        sameAttrs(existingLive.mark.attrs as CrossRefAttrs, newAttrs);
      if (!sameRange || !attrsMatch) {
        if (existingLive && existingFrom !== null && existingTo !== null) {
          tr.removeMark(existingFrom, existingTo, marks.crossRef);
        }
        tr.addMark(matchFrom, matchTo, marks.crossRef.create(newAttrs));
        modified = true;
      }
    } else if (existingLive && !existingLive.mark.attrs.committed) {
      // Nothing parses in the current run — drop the stale uncommitted mark.
      const from = tr.mapping.map(existingLive.from);
      const to = tr.mapping.map(existingLive.to);
      tr.removeMark(from, to, marks.crossRef);
      modified = true;
    }
  }

  return modified;
}

/**
 * Commit any uncommitted crossRef marks in a textblock when the caret isn't
 * inside it (e.g. user clicked elsewhere mid-typing). Used by the walk-all
 * pass for non-caret selections.
 */
function commitOrphans(tr: Transaction, $p: ResolvedPos): boolean {
  let modified = false;
  const ranges = collectCrossRefRanges($p);
  for (const r of ranges) {
    if (r.mark.attrs.committed) continue;
    const from = tr.mapping.map(r.from);
    const to = tr.mapping.map(r.to);
    const canonical = canonicalReferenceText(parsedFromMark(r.mark));
    const existingText = tr.doc.textBetween(from, to, "", "");
    const committedMark = marks.crossRef.create({
      ...r.mark.attrs,
      raw: canonical,
      committed: true,
    });
    if (existingText !== canonical) {
      tr.replaceWith(
        from,
        to,
        tr.doc.type.schema.text(canonical, [committedMark]),
      );
    } else {
      tr.removeMark(from, to, marks.crossRef);
      tr.addMark(from, to, committedMark);
    }
    modified = true;
  }
  return modified;
}

/** Find every contiguous crossRef-marked run in the parent textblock of `$p`. */
function collectCrossRefRanges($p: ResolvedPos): RangeRef[] {
  const parent = $p.parent;
  const parentStart = $p.start();
  const ranges: RangeRef[] = [];
  parent.forEach((node, offset) => {
    if (!node.isText) return;
    const m = node.marks.find((mk) => mk.type === marks.crossRef);
    if (!m) return;
    const from = parentStart + offset;
    const to = from + node.nodeSize;
    const last = ranges[ranges.length - 1];
    if (last?.to === from && last.mark.eq(m)) {
      last.to = to;
    } else {
      ranges.push({ from, to, mark: m });
    }
  });
  return ranges;
}

// ---------------------------------------------------------------------------
// Paste pass
// ---------------------------------------------------------------------------

/**
 * When the user pastes text containing references, run a full scan over the
 * pasted ranges and apply committed chips. We approximate "the pasted range"
 * as the union of step-affected ranges in this batch.
 */
function applyPasteScan(
  tr: Transaction,
  transactions: readonly Transaction[],
  state: EditorState,
): boolean {
  // Only act on transactions that look like paste / large bulk edits — a
  // single-char insertion is handled by the live detector. We use a 4-char
  // threshold to skip normal typing.
  let touchedFrom = Infinity;
  let touchedTo = -Infinity;
  let pasted = false;
  for (const t of transactions) {
    if (!t.docChanged) continue;
    let stepDelta = 0;
    t.mapping.maps.forEach((map) => {
      map.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
        stepDelta = Math.max(stepDelta, newTo - newFrom);
        touchedFrom = Math.min(touchedFrom, newFrom);
        touchedTo = Math.max(touchedTo, newTo);
      });
    });
    if (stepDelta >= 4) pasted = true;
  }
  if (!pasted || touchedFrom === Infinity) return false;

  let modified = false;
  state.doc.nodesBetween(
    touchedFrom,
    Math.min(touchedTo, state.doc.content.size),
    (node, pos) => {
      if (!node.isTextblock) return true;
      const $p = state.doc.resolve(pos + 1);
      if (isExcluded($p)) return false;
      // Scan each text-node child individually so atom nodes (verse_number,
      // image) don't shift our string→doc offset math. Each text node is a
      // contiguous run of inline characters at a known doc position.
      const textblockStart = pos + 1;
      node.forEach((child, offset) => {
        if (!child.isText) return;
        if (
          child.marks.some(
            (mk) => mk.type === marks.crossRef && mk.attrs.committed === true,
          )
        ) {
          return;
        }
        if (child.marks.some((mk) => mk.type === marks.code)) return;
        const text = child.text ?? "";
        const matches = findAllReferences(text);
        if (matches.length === 0) return;
        const childStart = textblockStart + offset;
        for (const m of matches) {
          const newMark = marks.crossRef.create({
            book: m.parsed.bookOrdinal,
            startChapter: m.parsed.startChapter,
            startVerse: m.parsed.startVerse,
            endChapter: m.parsed.endChapter,
            endVerse: m.parsed.endVerse,
            raw: canonicalReferenceText(m.parsed),
            committed: true,
          });
          const mappedFrom = tr.mapping.map(childStart + m.start);
          const mappedTo = tr.mapping.map(childStart + m.end);
          tr.addMark(mappedFrom, mappedTo, newMark);
          modified = true;
        }
      });
      return false;
    },
  );
  return modified;
}

// ---------------------------------------------------------------------------
// Click + double-click on chip
// ---------------------------------------------------------------------------

function findChipElement(target: EventTarget | null): HTMLElement | null {
  // `target` is typed as `EventTarget | null` from the DOM; in practice it's
  // always a Node when this fires from a click/dblclick. We narrow to
  // HTMLElement and walk parents until we find a chip wrapper.
  let el = target instanceof HTMLElement ? target : null;
  while (el !== null) {
    if (el.dataset.crossRef === "true") return el;
    el = el.parentElement;
  }
  return null;
}

function readChipAttrs(el: HTMLElement): CrossRefAttrs | null {
  const num = (k: string): number => {
    const v = Number(el.dataset[k] ?? "0");
    return Number.isFinite(v) ? v : 0;
  };
  const book = num("book");
  if (book < 1 || book > 66) return null;
  // `data-raw` is always emitted by toDOM (possibly empty). Explicit type
  // guard satisfies both `noUncheckedIndexedAccess` (TS narrows `dataset.raw`
  // to `string` in the true branch) and the type-aware lint rule (no `??`
  // chain on a LHS the linter considers non-nullable).
  const rawAttr = el.dataset.raw;
  const raw: string = typeof rawAttr === "string" ? rawAttr : "";
  return {
    book,
    startChapter: num("startChapter"),
    startVerse: num("startVerse"),
    endChapter: num("endChapter"),
    endVerse: num("endVerse"),
    raw,
    committed: true,
  };
}

/**
 * Suppress default caret placement on a plain left-click on a chip. Runs at
 * mousedown — by the time the browser fires `click` the caret has already
 * moved, so we intercept earlier. The follow-up `click` handler opens the
 * popover; the gesture as a whole behaves like a button click, not a hyperlink
 * navigation. Modifier-clicks and clicks on non-chip text fall through to
 * ProseMirror's normal handling.
 */
function handleMouseDown(_view: EditorView, event: MouseEvent): boolean {
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return false;
  }
  const chip = findChipElement(event.target);
  if (!chip) return false;
  event.preventDefault();
  return true;
}

function handleClick(_view: EditorView, event: MouseEvent): boolean {
  // Only plain left-click. Modifier-click should fall through to normal
  // behaviour (caret placement) so power users can still position the cursor.
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey ||
    event.detail >= 2
  ) {
    return false;
  }
  const chip = findChipElement(event.target);
  if (!chip) return false;
  const attrs = readChipAttrs(chip);
  if (!attrs) return false;
  const rect = chip.getBoundingClientRect();
  event.preventDefault();
  event.stopPropagation();
  window.dispatchEvent(
    new CustomEvent<CrossRefOpenEventDetail>(CROSS_REF_OPEN_EVENT, {
      detail: {
        attrs,
        anchorRect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
      },
    }),
  );
  return true;
}

function handleDoubleClick(event: MouseEvent): boolean {
  const chip = findChipElement(event.target);
  if (!chip) return false;
  const attrs = readChipAttrs(chip);
  if (!attrs) return false;
  // Bible Gateway in ESV — renders the actual range, lets the user switch
  // translations on the landing page. BibleHub can only link single verses.
  const url = bibleGatewayUrl(parsedFromAttrs(attrs), "ESV");
  if (!url) return false;
  event.preventDefault();
  event.stopPropagation();
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

/** Build a ParsedReference from chip attrs, for the URL builders. */
function parsedFromAttrs(attrs: CrossRefAttrs): ParsedReference {
  return {
    book: bookNameFromOrdinal(attrs.book),
    bookShort: bookShortFromOrdinal(attrs.book),
    bookOrdinal: attrs.book,
    startChapter: attrs.startChapter,
    startVerse: attrs.startVerse,
    endChapter: attrs.endChapter,
    endVerse: attrs.endVerse,
    startVerseId:
      attrs.book * 1_000_000 + attrs.startChapter * 1_000 + attrs.startVerse,
    endVerseId:
      attrs.book * 1_000_000 + attrs.endChapter * 1_000 + attrs.endVerse,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function parsedFromMark(mark: Mark): ParsedReference {
  const a = mark.attrs as CrossRefAttrs;
  return {
    book: bookNameFromOrdinal(a.book),
    bookShort: bookShortFromOrdinal(a.book),
    bookOrdinal: a.book,
    startChapter: a.startChapter,
    startVerse: a.startVerse,
    endChapter: a.endChapter,
    endVerse: a.endVerse,
    startVerseId: a.book * 1_000_000 + a.startChapter * 1_000 + a.startVerse,
    endVerseId: a.book * 1_000_000 + a.endChapter * 1_000 + a.endVerse,
  };
}

// Small lookups so we don't rebuild Maps each transaction.
const BOOK_NAME_BY_ORDINAL: ReadonlyMap<number, string> = new Map(
  BOOKS.map((b) => [b.ordinal, b.name]),
);
const BOOK_SHORT_BY_ORDINAL: ReadonlyMap<number, string> = new Map(
  BOOKS.map((b) => [b.ordinal, b.short]),
);
function bookNameFromOrdinal(ordinal: number): string {
  return BOOK_NAME_BY_ORDINAL.get(ordinal) ?? "";
}
function bookShortFromOrdinal(ordinal: number): string {
  return BOOK_SHORT_BY_ORDINAL.get(ordinal) ?? "";
}

function sameAttrs(a: CrossRefAttrs, b: CrossRefAttrs): boolean {
  return (
    a.book === b.book &&
    a.startChapter === b.startChapter &&
    a.startVerse === b.startVerse &&
    a.endChapter === b.endChapter &&
    a.endVerse === b.endVerse &&
    a.committed === b.committed
  );
}

// Re-export for tests / debugging.
export { findReferenceEndingAt };
export type { ReferenceMatch };
