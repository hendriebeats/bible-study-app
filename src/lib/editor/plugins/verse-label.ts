import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import { nodes, type VerseNumberAttrs } from "../schema";

/** Decoration spec a verse marker carries: its contextually-computed label and
 * whether it leads its chapter (the first verse of that chapter in the doc). */
export interface VerseLabelSpec {
  verseLabel: string;
  chapterLead: boolean;
}

/**
 * Computes the printed label for every `verse_number` in reading order: the
 * first verse of each chapter within the section renders as `chapter:verse`
 * (e.g. `3:20`) — even when that first verse isn't verse 1 — while every other
 * verse shows just its number. "First of a chapter" means its chapter differs
 * from the previous marker's; the very first marker always leads.
 *
 * Purely presentational: emitted as node decorations the {@link VerseNumberView}
 * reads, so it never touches the saved document or the autosave step log, and it
 * recomputes live as verses are inserted, deleted, or reordered. Each editor
 * runs the plugin over its own doc, so "section" = that document. Markers
 * without a structured chapter (older docs) are skipped — they keep rendering
 * via their stored `n`.
 */
export function verseLabel(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc } = state;
        const decorations: Decoration[] = [];
        let prevChapter: number | null = null;
        doc.descendants((node, pos) => {
          if (node.type !== nodes.verseNumber) {
            return true;
          }
          const attrs = node.attrs as VerseNumberAttrs;
          if (attrs.chapter == null || attrs.verse == null) {
            return false; // no structured location — leave the `n` fallback
          }
          const lead = attrs.chapter !== prevChapter;
          prevChapter = attrs.chapter;
          const label = lead
            ? `${String(attrs.chapter)}:${String(attrs.verse)}`
            : String(attrs.verse);
          const spec: VerseLabelSpec = { verseLabel: label, chapterLead: lead };
          decorations.push(
            Decoration.node(
              pos,
              pos + node.nodeSize,
              lead ? { class: "scripture-verse--chapter" } : {},
              spec,
            ),
          );
          return false;
        });
        return decorations.length > 0
          ? DecorationSet.create(doc, decorations)
          : null;
      },
    },
  });
}
