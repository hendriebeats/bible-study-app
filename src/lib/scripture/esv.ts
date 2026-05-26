import { normalizeScriptureOptions } from "@/lib/scripture/options";
import type { Passage, ScriptureProvider } from "@/lib/scripture/types";

const ESV_TEXT_ENDPOINT = "https://api.esv.org/v3/passage/text/";

/** Shape of the fields we use from the ESV text API response. */
interface EsvTextResponse {
  canonical: string;
  passages: string[];
}

/**
 * ESV provider. Requires an API key from https://api.esv.org (free for
 * non-commercial use). Responses are cached aggressively since the text of a
 * given reference never changes.
 */
export function createEsvProvider(apiKey: string): ScriptureProvider {
  return {
    version: "ESV",
    async getPassage(reference, options): Promise<Passage> {
      const opts = normalizeScriptureOptions(options);
      const url = new URL(ESV_TEXT_ENDPOINT);
      url.searchParams.set("q", reference);
      // Fixed params (not user options): verse numbers always on; footnotes and
      // the "(ESV)" copyright line always off; headings off (not exposed) and
      // passage-references off (the reference is shown by our own UI).
      url.searchParams.set("include-verse-numbers", "true");
      url.searchParams.set("include-footnotes", "false");
      url.searchParams.set("include-footnote-body", "false");
      url.searchParams.set("include-short-copyright", "false");
      url.searchParams.set("include-headings", "false");
      url.searchParams.set("include-passage-references", "false");
      // User-configurable (each combination is its own fetch cache key).
      url.searchParams.set("include-selahs", String(opts.includeSelahs));

      const response = await fetch(url, {
        headers: { Authorization: `Token ${apiKey}` },
        // Text is immutable; cache for 30 days.
        next: { revalidate: 60 * 60 * 24 * 30 },
      });

      if (!response.ok) {
        throw new Error(
          `ESV API request failed: ${String(response.status)} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as EsvTextResponse;
      return {
        reference: data.canonical,
        content: data.passages.join("\n\n").trim(),
        version: "ESV",
      };
    },
  };
}
