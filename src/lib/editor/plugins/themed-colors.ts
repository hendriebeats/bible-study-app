/**
 * Theme-aware custom-colour mark painter (ProseMirror Plugin).
 *
 * The schema's `colorMarkStyle` (see schema.ts) bakes the picker's stored
 * OKLCH literal directly into the mark's inline `style` — that way any
 * render surface (server-rendered HTML, history previews before JS, scripture
 * pulled into other views) shows *some* colour without JS. The downside: a
 * custom colour picked in light mode reads poorly in dark mode (and the
 * future sepia / high-contrast / … themes that will come once the rest of
 * the theme registry lands).
 *
 * This plugin paints the contrast-safe per-theme variant *on top* of the
 * baked-in colour, via PM's `Decoration.inline` mechanism. Because the
 * decoration flows through PM's own update path (transactions + reset of
 * `decorations` on apply), PM's internal DOMObserver never sees an
 * unexpected mutation — the earlier MutationObserver-based binder was
 * abandoned because mutating mark DOM directly re-entered PM's observer
 * and dead-locked the tab on theme toggle.
 *
 * Wired into both the live editor (`document-editor.tsx`) and the read-only
 * `<DocPreview>` (`doc-preview.tsx`). The plugin owns a small piece of
 * state — the active theme + the cached DecorationSet — and dispatches a
 * theme-change transaction whenever `<html data-theme="…">` flips so PM
 * picks up the new colours without remounting the view.
 */

import type { Node } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import { parseOklch } from "@/lib/editor/oklch";
import { marks } from "@/lib/editor/schema";
import { resolveColor } from "@/lib/theme/resolve-color";
import { isThemeId, type ThemeId } from "@/lib/theme/themes";

interface PluginState {
  theme: ThemeId;
  decorations: DecorationSet;
}

const key = new PluginKey<PluginState>("themed-colors");

function activeTheme(): ThemeId {
  if (typeof document === "undefined") return "light";
  const raw = document.documentElement.getAttribute("data-theme");
  return isThemeId(raw) ? raw : "light";
}

/**
 * Walk every inline node in `doc` and emit one inline Decoration per
 * highlight / text-colour mark whose `color` parses as OKLCH. Each decoration
 * carries an inline `style` that overrides the schema-baked colour with the
 * theme-resolved variant. Preset palette values resolve to themselves so the
 * decoration is effectively a no-op, but the cost is tiny — palette use is
 * sparse and the resolver memoises.
 */
function buildDecorations(doc: Node, theme: ThemeId): DecorationSet {
  const collected: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.marks.length === 0) return;
    for (const mark of node.marks) {
      if (mark.type !== marks.highlight && mark.type !== marks.textColor) {
        continue;
      }
      const raw = (mark.attrs as { color: string }).color;
      const stored = parseOklch(raw);
      if (stored === null) continue;
      const surface = mark.type === marks.highlight ? "highlight" : "textColor";
      const resolved = resolveColor(stored, theme, surface);
      const prop = surface === "highlight" ? "background-color" : "color";
      collected.push(
        Decoration.inline(pos, pos + node.nodeSize, {
          // PM's inline decoration merges this `style` into the mark element's
          // existing `style` attribute. Same property → declaration order wins
          // (later declarations override), and PM appends decoration attrs
          // after the schema-rendered ones, so `resolved` always paints.
          style: `${prop}: ${resolved}`,
        }),
      );
    }
  });
  return DecorationSet.create(doc, collected);
}

/**
 * The plugin. Install once per editor view; theme changes are picked up via
 * a MutationObserver on `<html data-theme>`, which dispatches an empty
 * transaction tagged with the new theme so `apply` can rebuild the
 * DecorationSet through PM's standard update cycle.
 */
export function themedColors(): Plugin {
  return new Plugin<PluginState>({
    key,
    state: {
      init(_config, state) {
        const theme = activeTheme();
        return { theme, decorations: buildDecorations(state.doc, theme) };
      },
      apply(tr, prev, _old, next) {
        const themeMeta = tr.getMeta(key) as ThemeId | undefined;
        if (themeMeta !== undefined && themeMeta !== prev.theme) {
          return {
            theme: themeMeta,
            decorations: buildDecorations(next.doc, themeMeta),
          };
        }
        if (tr.docChanged) {
          // Colour marks are sparse, so a full rebuild is cheap enough; the
          // alternative (decorations.map(tr.mapping, tr.doc) + per-step diff)
          // adds complexity without a measurable win at these sizes.
          return {
            theme: prev.theme,
            decorations: buildDecorations(next.doc, prev.theme),
          };
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        return key.getState(state)?.decorations ?? null;
      },
    },
    view(view) {
      // `<html data-theme="…">` is owned by next-themes; we watch it via
      // MutationObserver so we don't need a React context bridge into PM
      // and the plugin stays usable from any host (DocPreview included).
      const themeObserver = new MutationObserver(() => {
        const current = key.getState(view.state)?.theme;
        const next = activeTheme();
        if (current === next) return;
        view.dispatch(view.state.tr.setMeta(key, next));
      });
      if (typeof document !== "undefined") {
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme"],
        });
      }
      return {
        destroy() {
          themeObserver.disconnect();
        },
      };
    },
  });
}
