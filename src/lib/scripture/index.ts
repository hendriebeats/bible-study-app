import { createEsvProvider } from "@/lib/scripture/esv";
import type { ScriptureProvider } from "@/lib/scripture/types";

let cached: ScriptureProvider | undefined;

/**
 * Returns the configured scripture provider (currently ESV). Swap translations
 * by changing what this builds — every caller stays the same.
 */
export function getScriptureProvider(): ScriptureProvider {
  if (!cached) {
    const apiKey = process.env.ESV_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing ESV_API_KEY environment variable. See SETUP.md to obtain one.",
      );
    }
    cached = createEsvProvider(apiKey);
  }
  return cached;
}

export type { Passage, ScriptureProvider } from "@/lib/scripture/types";
