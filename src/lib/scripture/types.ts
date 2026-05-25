/** A resolved scripture passage, independent of the underlying translation. */
export interface Passage {
  /** Canonical reference as resolved by the provider, e.g. "John 3:16–17". */
  reference: string;
  /** The passage text (plain text for now; may be HTML for richer providers). */
  content: string;
  /** Translation identifier, e.g. "ESV". */
  version: string;
}

/**
 * A swappable source of scripture text. Add a new translation by implementing
 * this interface and wiring it up in `./index.ts` — nothing else changes.
 */
export interface ScriptureProvider {
  readonly version: string;
  getPassage(reference: string): Promise<Passage>;
}
