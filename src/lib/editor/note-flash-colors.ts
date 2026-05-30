/**
 * Colour value for the inline-row flash (`flashNoteEntry` in
 * `notes-index-view.ts`).
 *
 * Uses `--note-active-bg` — the SAME theme token that paints the yellow
 * over a note's anchored text (`.note-ref.note-active` in globals.css).
 * Tying the flash to the highlight means they always read as the same
 * "highlighter is on" signal; tuning the highlight tunes the flash too.
 *
 * The `var(…, fallback)` second argument is a literal rgba so a stale
 * HMR-cached globals.css (one that doesn't yet have the token defined)
 * still resolves to visible yellow. The fallback alpha is deliberately
 * low so that even in that fallback case the flash stays gentle. This
 * file is in `lint-rules/no-raw-colors.mjs`'s exempt list because the
 * fallback `rgba(…)` is a literal colour by design.
 */

/** Translucent highlighter yellow for the row flash. Tracks the anchor
 * highlight (`--note-active-bg`) so both surfaces read identically. */
export const NOTE_FLASH_BG = "var(--note-active-bg, rgba(255, 234, 0, 0.4))";
