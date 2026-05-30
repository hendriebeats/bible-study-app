import {
  type MarkType,
  type NodeSpec,
  type NodeType,
  Schema,
  type TagParseRule,
} from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { tableNodes } from "prosemirror-tables";

import { normalizeTone } from "./block-tones";
import { isHighlightColor, isTextColor } from "./format-colors";

/**
 * Build the inline `style` for a colour-bearing mark. Every value — preset or
 * custom — emits the stored OKLCH literal directly, so every render surface
 * (live editor, read-only viewer, history previews, server-rendered HTML)
 * shows *some* colour with zero JS. For custom values, the
 * {@link themedColors} ProseMirror plugin (src/lib/editor/plugins/themed-
 * colors.ts) paints theme-resolved inline-style decorations over each
 * `[data-color]` mark once the editor mounts — this is what makes a custom
 * highlight picked in light mode stay legible after the user flips to dark
 * (or any future theme).
 *
 * `prop` is the CSS property the mark drives — `background-color` for
 * highlights, `color` for text colour.
 */
function colorMarkStyle(
  prop: "background-color" | "color",
  color: string,
): string {
  return `${prop}:${color}`;
}

/**
 * The single ProseMirror schema for every study document.
 *
 * It MUST be the only schema instance used by the editor, the read-only viewer,
 * diffing, and all step/doc (de)serialization: `Step.fromJSON` and
 * `Node.fromJSON` only accept JSON produced against this exact schema, and
 * persisted history would fail to deserialize against a forked one. Never
 * create another schema — extend this one here. (See plan Risk #5.)
 *
 * Covers the editor's full prose feature set: headings,
 * bold/italic/strikethrough, bullet/ordered lists, blockquote, code, code
 * block, horizontal rule, hard break. Plus the study-specific nodes:
 *   * `verse_number` — an inline atom rendered as a superscript verse number.
 *     Inserted scripture lands as ordinary editable paragraphs with one of these
 *     locked in front of each verse's first word (protected by the verse-guard
 *     plugin so it can't be deleted/edited), so users can split, format, and
 *     annotate the passage freely.
 *   * `scripture` — LEGACY: the old non-editable passage atom. No longer
 *     inserted, but kept registered (with its NodeView) so documents/steps saved
 *     before editable scripture still deserialize and render. Never remove it.
 *   * `study_block` — a titled work area (Observation/Interpretation/…) holding
 *     the user's editable content. `title`/`subtitle` are admin-authored chrome;
 *     `placeholder` is the suggested body text shown while the body is empty.
 *     `lineageId` is the shared "slot" that lets blocks line up across members'
 *     studies; `templateId` records the genre template it came from.
 */

// `schema-basic` covers paragraphs, headings, blockquote, code/code_block,
// horizontal_rule, hard_break, image, and the strong/em/code/link marks. The
// flat-schema rewrite (Phase 5) replaced the old `bullet_list` / `ordered_list`
// / `task_list` wrapper nodes with a single attr-discriminated `list_row`
// (see below), so we no longer pull in `prosemirror-schema-list`'s list nodes
// at all — basic's spec is the starting point as-is.
const baseNodeSpecs = basicSchema.spec.nodes;

/**
 * Attributes carried by a {@link verseNumberSpec} node. `n` is the printed
 * marker text exactly as ESV emits it ("1" or "3:16") — the fallback label and
 * what lands on the clipboard. `book`/`chapter`/`verse` are the structured
 * location (book ordinal 1–66 + chapter/verse numbers) stamped at insertion
 * time; they power the contextual `chapter:verse` display and the BibleHub link.
 * All three are `null` on markers inserted before this was added (back-compat).
 */
export interface VerseNumberAttrs {
  n: string;
  book: number | null;
  chapter: number | null;
  verse: number | null;
}

/** Parse a numeric DOM attribute, returning null when absent or non-numeric. */
function numAttr(dom: HTMLElement, name: string): number | null {
  const raw = dom.getAttribute(name);
  if (raw == null || raw === "") return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Verse number: an inline ATOM rendered as a `<sup>` superscript. It carries the
 * printed marker (`n`) plus its structured `book`/`chapter`/`verse` location and
 * no editable content, so it can't be typed into. The verse-guard plugin keeps
 * it from being deleted and makes it "stick" to the following word;
 * `selectable: false` stops it being click/drag-selected on its own. The live
 * label (e.g. `3:20` for a chapter's first verse) is computed by the verse-label
 * decoration plugin + VerseNumberView, not stored here.
 */
const verseNumberSpec: NodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  attrs: {
    n: { default: "" },
    book: { default: null },
    chapter: { default: null },
    verse: { default: null },
  },
  parseDOM: [
    {
      tag: "sup.scripture-verse",
      getAttrs(dom) {
        if (typeof dom === "string") return null;
        return {
          n: dom.getAttribute("data-verse") ?? "",
          book: numAttr(dom, "data-book"),
          chapter: numAttr(dom, "data-chapter"),
          verse: numAttr(dom, "data-vn"),
        };
      },
    },
  ],
  toDOM(node) {
    const attrs = node.attrs as VerseNumberAttrs;
    const label =
      attrs.n !== "" ? attrs.n : attrs.verse != null ? String(attrs.verse) : "";
    const out: Record<string, string> = {
      class: "scripture-verse",
      "data-verse": label,
    };
    if (attrs.book != null) out["data-book"] = String(attrs.book);
    if (attrs.chapter != null) out["data-chapter"] = String(attrs.chapter);
    if (attrs.verse != null) out["data-vn"] = String(attrs.verse);
    return ["sup", out, label];
  },
};

/**
 * Scripture: LEGACY non-editable passage atom (see the schema doc comment).
 * Editable scripture now inserts ordinary paragraphs + {@link verseNumberSpec}
 * instead; this spec stays only so older saved documents/steps keep working.
 */
const scriptureSpec: NodeSpec = {
  group: "block",
  atom: true,
  selectable: true,
  isolating: true,
  attrs: {
    reference: { default: "" },
    version: { default: "ESV" },
    passageId: { default: null },
    text: { default: "" },
  },
  parseDOM: [
    {
      tag: "div[data-scripture]",
      getAttrs(dom) {
        if (typeof dom === "string") return null;
        return {
          reference: dom.getAttribute("data-reference") ?? "",
          version: dom.getAttribute("data-version") ?? "ESV",
          passageId: dom.getAttribute("data-passage-id"),
          text: dom.getAttribute("data-text") ?? "",
        };
      },
    },
  ],
  toDOM(node) {
    const attrs = node.attrs as {
      reference: string;
      version: string;
      passageId: string | null;
      text: string;
    };
    return [
      "div",
      {
        "data-scripture": "true",
        "data-reference": attrs.reference,
        "data-version": attrs.version,
        ...(attrs.passageId === null
          ? {}
          : { "data-passage-id": attrs.passageId }),
        "data-text": attrs.text,
        class: "scripture",
      },
      ["div", { class: "scripture-ref" }, attrs.reference],
      ["div", { class: "scripture-text" }, attrs.text],
    ];
  },
};

/**
 * Study block: a titled, templated work area. `content: "block+"` holds the
 * user's editable paragraphs/lists; the title + subtitle render as non-editable
 * chrome and `placeholder` is the suggested text shown while the body is empty.
 * `lineageId` is the cross-study slot; `templateId` records the genre template
 * it came from. Legacy blocks stored `label`/`prompt`; parseDOM falls back to
 * those so older documents still resolve a title/placeholder.
 *
 * `variant` discriminates the visual shape:
 *   * `"standard"` (default) — the full titled card with an editable body.
 *   * `"action"` — a reminder bar with header + subheader centered, no
 *     visible body. Used for "do this, don't write anything" steps like
 *     opening prayer. The body still exists structurally (`block+` content
 *     is unchanged, so existing docs and the structure guard keep working)
 *     but the NodeView + CSS hide it.
 *
 * `tone` picks the background tone of an action-variant bar (a small
 * theme-aware palette defined in `block-tones.ts` + globals.css). Ignored
 * for standard blocks today; the attr lives on every study_block so a future
 * pass can tint standard cards too without a schema migration.
 */
const studyBlockSpec: NodeSpec = {
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  attrs: {
    title: { default: "" },
    subtitle: { default: "" },
    placeholder: { default: "" },
    lineageId: { default: null },
    templateId: { default: null },
    variant: { default: "standard" },
    tone: { default: "default" },
  },
  parseDOM: [
    {
      tag: "section[data-study-block]",
      contentElement: ".study-block-body",
      getAttrs(dom) {
        if (typeof dom === "string") return null;
        const variant = dom.getAttribute("data-variant");
        return {
          title:
            dom.getAttribute("data-title") ??
            dom.getAttribute("data-label") ??
            "",
          subtitle: dom.getAttribute("data-subtitle") ?? "",
          placeholder:
            dom.getAttribute("data-placeholder") ??
            dom.getAttribute("data-prompt") ??
            "",
          lineageId: dom.getAttribute("data-lineage-id"),
          templateId: dom.getAttribute("data-template-id"),
          variant: variant === "action" ? "action" : "standard",
          tone: normalizeTone(dom.getAttribute("data-tone")),
        };
      },
    },
  ],
  toDOM(node) {
    const attrs = node.attrs as {
      title: string;
      subtitle: string;
      placeholder: string;
      lineageId: string | null;
      templateId: string | null;
      variant: string;
      tone: string;
    };
    const variant = attrs.variant === "action" ? "action" : "standard";
    const tone = normalizeTone(attrs.tone);
    return [
      "section",
      {
        "data-study-block": "true",
        "data-title": attrs.title,
        "data-subtitle": attrs.subtitle,
        "data-placeholder": attrs.placeholder,
        "data-variant": variant,
        "data-tone": tone,
        ...(attrs.lineageId === null
          ? {}
          : { "data-lineage-id": attrs.lineageId }),
        ...(attrs.templateId === null
          ? {}
          : { "data-template-id": attrs.templateId }),
        class:
          `study-block study-block--${variant}` +
          ` study-block--tone-${tone} study-stack-item`,
      },
      [
        "div",
        { class: "study-block-title", contenteditable: "false" },
        attrs.title,
      ],
      ["div", { class: "study-block-body" }, 0],
    ];
  },
};

/**
 * Block indentation. Every indentable textblock (paragraph, heading,
 * `list_row`, code_block) and every indentable wrapper (blockquote, callout,
 * collapsible) carries an `indent` level (0…{@link MAX_INDENT}) rendered as a
 * left margin and adjusted by Tab / Shift-Tab. `default: 0` keeps every
 * previously-saved document and step valid (they simply deserialize at
 * indent 0).
 *
 * The flat-schema rewrite (Phase 2) made indent a pure attribute edit; the
 * old "sink/lift list_item then attr-fallback" hybrid is gone — there are no
 * structural list nodes left to sink/lift.
 */
export const MAX_INDENT = 15;
const INDENT_STEP_REM = 1.75;

/** Clamp an untrusted indent value to a whole number in [0, MAX_INDENT]. */
function clampIndent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_INDENT, Math.max(0, Math.trunc(value)));
}

/** DOM attributes (data + inline margin) for an indent level; empty at 0. */
function indentDOMAttrs(indent: number): Record<string, string> {
  if (indent <= 0) return {};
  return {
    "data-indent": String(indent),
    style: `margin-inline-start:${String(indent * INDENT_STEP_REM)}rem`,
  };
}

// Paragraph + heading replace the `schema-basic` specs with an added `indent`
// attribute (everything else about them is unchanged).
const paragraphSpec: NodeSpec = {
  content: "inline*",
  group: "block",
  attrs: { indent: { default: 0 } },
  parseDOM: [
    {
      tag: "p",
      getAttrs(dom) {
        if (typeof dom === "string") return null;
        return { indent: clampIndent(numAttr(dom, "data-indent") ?? 0) };
      },
    },
  ],
  toDOM(node) {
    return ["p", indentDOMAttrs(node.attrs.indent as number), 0];
  },
};

const headingSpec: NodeSpec = {
  attrs: { level: { default: 1 }, indent: { default: 0 } },
  content: "inline*",
  group: "block",
  defining: true,
  parseDOM: ([1, 2, 3, 4, 5, 6] as const).map(
    (level): TagParseRule => ({
      tag: `h${String(level)}`,
      getAttrs(dom) {
        if (typeof dom === "string") return null;
        return { level, indent: clampIndent(numAttr(dom, "data-indent") ?? 0) };
      },
    }),
  ),
  toDOM(node) {
    const level = node.attrs.level as number;
    return [
      `h${String(level)}`,
      indentDOMAttrs(node.attrs.indent as number),
      0,
    ];
  },
};

/**
 * Blockquote override (was schema-basic's default). Adds the universal
 * `indent` attribute so Tab/Shift-Tab on a blockquote's own line shifts the
 * whole quote, matching every other block in the Phase 1b flat-schema target.
 */
const blockquoteSpec: NodeSpec = {
  content: "block+",
  group: "block",
  defining: true,
  attrs: { indent: { default: 0 } },
  parseDOM: [
    {
      tag: "blockquote",
      getAttrs(dom) {
        if (typeof dom === "string") return null;
        return { indent: clampIndent(numAttr(dom, "data-indent") ?? 0) };
      },
    },
  ],
  toDOM(node) {
    return ["blockquote", indentDOMAttrs(node.attrs.indent as number), 0];
  },
};

/**
 * Code block override (was schema-basic's default). Same `indent` story as
 * {@link blockquoteSpec}; code_block intentionally does NOT carry the new
 * `listType` attribute (a list marker overlay would clash with the monospace
 * gutter / line-number chrome), per Phase 1a sign-off.
 */
const codeBlockSpec: NodeSpec = {
  content: "text*",
  marks: "",
  group: "block",
  code: true,
  defining: true,
  attrs: { indent: { default: 0 } },
  parseDOM: [
    {
      tag: "pre",
      preserveWhitespace: "full",
      getAttrs(dom) {
        if (typeof dom === "string") return null;
        return { indent: clampIndent(numAttr(dom, "data-indent") ?? 0) };
      },
    },
  ],
  toDOM(node) {
    return ["pre", indentDOMAttrs(node.attrs.indent as number), ["code", 0]];
  },
};

/**
 * Image node — overrides `prosemirror-schema-basic`'s default `image` spec
 * via `.update("image", imageSpec)` in the nodeSpecs chain below. (Adding it
 * via `.addToEnd` would collide on the "image" name.)
 *
 * The node is an `atom` block: no editable children, draggable like any other
 * block, slots wherever `paragraph` does (so it works inside callout,
 * collapsible, study_block bodies, and notes). Crop / rotation / flip live
 * as ATTRS — rendering uses CSS transforms inside an overflow:hidden frame,
 * so there's no derivative file and Reset is free.
 *
 * `parseDOM` deliberately matches only our own `<figure data-image>` shape.
 * Bare `<img>` from HTML clipboards is intercepted by the image-paste plugin
 * (re-uploaded into our bucket) before PM's parser ever sees it; matching
 * raw `<img>` here would let off-site URLs slip into the doc.
 */
const imageSpec: NodeSpec = {
  group: "block",
  atom: true,
  draggable: true,
  defining: true,
  attrs: {
    src: { default: "" },
    naturalW: { default: 0 },
    naturalH: { default: 0 },
    // Legacy: 0 = natural-fit sentinel; 15–100 = percent of the container.
    // Existing docs that stored percents still render via this attr — the
    // NodeView falls back to it when `widthPx` is 0.
    width: { default: 0 },
    // Fixed pixel width. When >0 the frame renders at exactly this many
    // CSS pixels (capped by max-width:100% so it never overflows the
    // containing column). Set by the resize handle and the crop-commit
    // path going forward, so the rendered size doesn't scale with the
    // window. Defaults to 0 (= use legacy `width` percent / natural-fit).
    widthPx: { default: 0 },
    // 0 means "derive from aspect ratio" (the default — height follows
    // width via the cropped image's natural aspect). A positive pixel
    // value forces an explicit height, which lets the side handles
    // (top/bottom) stretch the image vertically while leaving its width
    // alone. Corner handles preserve aspect by always clearing this back
    // to 0; left/right side handles also lock the current height so the
    // image stretches horizontally.
    height: { default: 0 },
    align: { default: "left" },
    crop: { default: null },
    rotation: { default: 0 },
    flipH: { default: false },
    flipV: { default: false },
    status: { default: "ready" },
  },
  parseDOM: [
    {
      tag: "figure[data-image]",
      getAttrs(dom) {
        if (typeof dom === "string") return null;
        const get = (k: string) => dom.getAttribute(k);
        const num = (k: string, def: number) => {
          const raw = get(k);
          if (raw == null) return def;
          const n = Number(raw);
          return Number.isFinite(n) ? n : def;
        };
        let crop: { x: number; y: number; w: number; h: number } | null = null;
        const cropRaw = get("data-crop");
        if (cropRaw) {
          try {
            const parsed: unknown = JSON.parse(cropRaw);
            if (
              parsed &&
              typeof parsed === "object" &&
              typeof (parsed as Record<string, unknown>).x === "number"
            ) {
              crop = parsed as { x: number; y: number; w: number; h: number };
            }
          } catch {
            crop = null;
          }
        }
        const alignRaw = get("data-align");
        const align =
          alignRaw === "left" || alignRaw === "full" ? alignRaw : "center";
        const rotRaw = num("data-rotation", 0);
        const rotation =
          rotRaw === 90 || rotRaw === 180 || rotRaw === 270 ? rotRaw : 0;
        const statusRaw = get("data-status");
        const status =
          statusRaw === "uploading" || statusRaw === "broken"
            ? statusRaw
            : "ready";
        return {
          src: get("data-src") ?? "",
          naturalW: num("data-natural-w", 0),
          naturalH: num("data-natural-h", 0),
          width: num("data-width", 100),
          widthPx: num("data-width-px", 0),
          height: num("data-height", 0),
          align,
          crop,
          rotation,
          flipH: get("data-flip-h") === "true",
          flipV: get("data-flip-v") === "true",
          status,
        };
      },
    },
  ],
  toDOM(node) {
    const a = node.attrs as Record<string, unknown>;
    const num = (v: unknown, def: number): string =>
      String(typeof v === "number" && Number.isFinite(v) ? v : def);
    const str = (v: unknown, def: string): string =>
      typeof v === "string" ? v : def;
    const src = typeof a.src === "string" ? a.src : "";
    const attrs: Record<string, string> = {
      "data-image": "",
      "data-src": src,
      "data-natural-w": num(a.naturalW, 0),
      "data-natural-h": num(a.naturalH, 0),
      "data-width": num(a.width, 100),
      "data-width-px": num(a.widthPx, 0),
      "data-height": num(a.height, 0),
      "data-align": str(a.align, "center"),
      "data-rotation": num(a.rotation, 0),
      "data-flip-h": a.flipH ? "true" : "false",
      "data-flip-v": a.flipV ? "true" : "false",
      "data-status": str(a.status, "ready"),
    };
    if (a.crop) attrs["data-crop"] = JSON.stringify(a.crop);
    return ["figure", attrs, ["img", { src, alt: "" }]];
  },
};

/**
 * Flat-schema list row (Phase 1b — additive, not yet driven by editing
 * commands). One node type subsumes `list_item` AND `task_item`; `listType`
 * discriminates bullet / ordered / task. Content is `inline*` (a row holds
 * text directly — no inner paragraph), and visual grouping into a "list run"
 * is a CSS concern over contiguous siblings sharing `listType`.
 *
 * - `indent` (0…{@link MAX_INDENT}) is the universal block indent.
 * - `checked` is meaningful only when `listType === "task"`; ignored otherwise
 *   but persisted so toggling list types round-trips the check state.
 * - `listStart` is the explicit run-starting number for ordered rows (null →
 *   continues the previous run's implicit count). Bullet/task rows ignore it.
 *
 * Phase 1b emits a `<div data-list-row>` (not `<li>`) so the row renders
 * cleanly without a surrounding `<ul>`/`<ol>`; Phase 3 introduces a NodeView
 * that draws the marker and the contiguous-run grouping in CSS. Until then,
 * any list_row that *does* appear in a migrated doc shows as an indented
 * line — no marker, but text + indent intact.
 */
const listRowSpec: NodeSpec = {
  group: "block",
  content: "inline*",
  attrs: {
    indent: { default: 0 },
    listType: { default: "bullet" },
    checked: { default: false },
    listStart: { default: null },
  },
  parseDOM: [
    {
      tag: "div[data-list-row]",
      getAttrs(dom) {
        if (typeof dom === "string") return null;
        const listType = dom.getAttribute("data-list-type") ?? "bullet";
        return {
          indent: clampIndent(numAttr(dom, "data-indent") ?? 0),
          listType,
          checked: dom.getAttribute("data-checked") === "true",
          listStart: numAttr(dom, "data-list-start"),
        };
      },
    },
  ],
  toDOM(node) {
    const indent = clampIndent(node.attrs.indent as number);
    const listType = String(node.attrs.listType);
    const checked = node.attrs.checked === true;
    const start = node.attrs.listStart as number | null;
    const extra = indentDOMAttrs(indent);
    const attrs: Record<string, string> = {
      "data-list-row": "true",
      "data-list-type": listType,
      class: `list-row list-row-${listType}`,
      ...extra,
    };
    if (listType === "task") attrs["data-checked"] = String(checked);
    if (start !== null) attrs["data-list-start"] = String(start);
    return ["div", attrs, 0];
  },
};

/** Callout (admonition) box. `variant` (note/insight/warning/prayer/application)
 * drives the color + header via the CalloutView node view and CSS. `indent`
 * shifts the whole callout (Phase 1b universal indent). */
const calloutSpec: NodeSpec = {
  group: "block",
  content: "block+",
  defining: true,
  attrs: { variant: { default: "note" }, indent: { default: 0 } },
  parseDOM: [
    {
      tag: "aside[data-callout]",
      contentElement: ".callout-body",
      getAttrs(dom) {
        if (typeof dom === "string") return null;
        return {
          variant: dom.getAttribute("data-variant") ?? "note",
          indent: clampIndent(numAttr(dom, "data-indent") ?? 0),
        };
      },
    },
  ],
  toDOM(node) {
    const variant = String(node.attrs.variant);
    const indent = clampIndent(node.attrs.indent as number);
    return [
      "aside",
      {
        "data-callout": "true",
        "data-variant": variant,
        class: `callout callout-${variant}`,
        ...indentDOMAttrs(indent),
      },
      ["div", { class: "callout-body" }, 0],
    ];
  },
};

/**
 * Collapsible (toggleable) section. Notion-style: the FIRST child is the
 * header (rendered next to a chevron marker, like a bullet point); the
 * remaining children are the body, hidden by CSS when `open: false`. The
 * header can be ANY block — a paragraph, a heading, a bullet item, a task —
 * so the user can convert it freely with markdown shortcuts or the slash
 * menu. The "first child is the header" invariant lives at the *display*
 * layer (NodeView + CSS), not in the schema content rule.
 *
 * Content stays as `block+` (not `paragraph block*`) for that reason —
 * tightening it to `paragraph block*` would silently break `findWrapping` /
 * `setBlockType` for every markdown shortcut typed into the header.
 *
 * The `summary` attribute is DEPRECATED — it predates this shape, when the
 * title lived on the node instead of as content. It's kept (default "") so
 * pre-migration step logs still deserialize cleanly. New code never sets it;
 * a one-time SQL migration moved every non-empty `summary` from production
 * documents/checkpoints/templates into a leading paragraph.
 */
const collapsibleSpec: NodeSpec = {
  group: "block",
  content: "block+",
  defining: true,
  attrs: {
    open: { default: true },
    summary: { default: "" },
    indent: { default: 0 },
  },
  parseDOM: [
    {
      tag: "div[data-collapsible]",
      // The DOM rendering puts every child (header + body) into a single
      // .collapsible-content wrapper; the NodeView mirrors that.
      contentElement: ".collapsible-content",
      getAttrs(dom) {
        if (typeof dom === "string") return null;
        return {
          open: dom.getAttribute("data-open") !== "false",
          // Don't restore deprecated summary from the DOM; if the SQL migration
          // somehow missed a row we still parse the doc — the body just won't
          // show the legacy title (acceptable, and rare).
          summary: "",
          indent: clampIndent(numAttr(dom, "data-indent") ?? 0),
        };
      },
    },
  ],
  toDOM(node) {
    const indent = clampIndent(node.attrs.indent as number);
    return [
      "div",
      {
        "data-collapsible": "true",
        "data-open": String(node.attrs.open !== false),
        class: "collapsible",
        ...indentDOMAttrs(indent),
      },
      ["div", { class: "collapsible-content" }, 0],
    ];
  },
};

/**
 * Notes (shared annotations). A `note_entry` holds one note's rich-text body
 * (`block+`) plus the `id` that links it to its anchor, the `source` document
 * its anchor lives in ("notes"/"blocks"), and the nearest `verseRef` (filled in
 * a later sub-phase; blank when the anchor isn't near a verse). The `notes_index`
 * is the single container that holds every note's body for a section — pinned as
 * the first block of the Study-blocks document. Bodies live here (not in the
 * doc the anchor sits in), so the whole index is versioned with the blocks doc.
 */
const noteEntrySpec: NodeSpec = {
  content: "block+",
  defining: true,
  isolating: true,
  attrs: {
    id: { default: "" },
    source: { default: "blocks" },
    verseRef: { default: "" },
  },
  parseDOM: [
    {
      tag: "div[data-note-entry]",
      contentElement: ".note-entry-body",
      getAttrs(dom) {
        if (typeof dom === "string") return null;
        return {
          id: dom.getAttribute("data-id") ?? "",
          source: dom.getAttribute("data-source") ?? "blocks",
          verseRef: dom.getAttribute("data-verse-ref") ?? "",
        };
      },
    },
  ],
  toDOM(node) {
    const attrs = node.attrs as {
      id: string;
      source: string;
      verseRef: string;
    };
    return [
      "div",
      {
        "data-note-entry": "true",
        "data-id": attrs.id,
        "data-source": attrs.source,
        "data-verse-ref": attrs.verseRef,
        class: "note-entry",
      },
      [
        "div",
        { class: "note-entry-ref", contenteditable: "false" },
        attrs.verseRef,
      ],
      ["div", { class: "note-entry-body" }, 0],
    ];
  },
};

const notesIndexSpec: NodeSpec = {
  group: "block",
  content: "note_entry*",
  defining: true,
  isolating: true,
  parseDOM: [
    { tag: "div[data-notes-index]", contentElement: ".notes-index-body" },
  ],
  toDOM() {
    return [
      "div",
      { "data-notes-index": "true", class: "notes-index study-stack-item" },
      [
        "div",
        { class: "study-block-layout" },
        [
          "div",
          { class: "study-block-header", contenteditable: "false" },
          ["div", { class: "notes-index-title" }, "Notes"],
        ],
        ["div", { class: "notes-index-body study-block-body" }, 0],
      ],
    ];
  },
};

/**
 * Tables (opt-in `tables` tool). The standard `prosemirror-tables` nodes —
 * `table` holds rows, cells carry block content. Added to the shared schema so
 * any document containing a table deserializes/renders everywhere (editor,
 * read-only viewer, history previews); the `tableEditing` plugin (editable
 * views only) and the slash / block menus drive structural editing.
 * `tableGroup: "block"` lets a table sit as a top-level block.
 */
const tableNodeSpecs = tableNodes({
  tableGroup: "block",
  cellContent: "block+",
  cellAttributes: {
    // Per-cell horizontal text alignment. `null` = inherit (the default); the
    // column-handle popover writes one of "left" | "center" | "right" to every
    // cell in the targeted column via `setColumnAlign` in `table-commands.ts`.
    // Round-trips through an inline `text-align` style (so paste into other
    // rich-text apps preserves alignment) and a matching `.pm-cell-align-*`
    // class so CSS selectors can hook the value.
    align: {
      default: null,
      getFromDOM: (dom) => {
        const value = dom.style.textAlign;
        return value === "left" || value === "center" || value === "right"
          ? value
          : null;
      },
      setDOMAttr: (value, attrs) => {
        if (value === "left" || value === "center" || value === "right") {
          attrs.style = `${(attrs.style as string | undefined) ?? ""}text-align:${value};`;
          attrs.class =
            `${(attrs.class as string | undefined) ?? ""} pm-cell-align-${value}`.trim();
        }
      },
    },
  },
});

const nodeSpecs = baseNodeSpecs
  .update("paragraph", paragraphSpec)
  .update("heading", headingSpec)
  .update("blockquote", blockquoteSpec)
  .update("code_block", codeBlockSpec)
  .update("image", imageSpec)
  .addToEnd("verse_number", verseNumberSpec)
  .addToEnd("scripture", scriptureSpec)
  .addToEnd("study_block", studyBlockSpec)
  .addToEnd("list_row", listRowSpec)
  .addToEnd("callout", calloutSpec)
  .addToEnd("collapsible", collapsibleSpec)
  .addToEnd("note_entry", noteEntrySpec)
  .addToEnd("notes_index", notesIndexSpec)
  .addToEnd("table", tableNodeSpecs.table)
  .addToEnd("table_row", tableNodeSpecs.table_row)
  .addToEnd("table_cell", tableNodeSpecs.table_cell)
  .addToEnd("table_header", tableNodeSpecs.table_header);

// Extend the inherited `link` mark with cached preview attrs (displayTitle,
// favicon, siteName). The hover preview plugin lazily backfills these on the
// first hover of a legacy link, so docs stored before this change parse
// cleanly with the new attrs defaulted to `null`. `toDOM` writes only the
// standard `href`/`title` to the rendered <a>, so HTML serialization remains
// round-trip compatible with the schema-basic shape.
const baseLinkSpec = basicSchema.spec.marks.get("link");
if (!baseLinkSpec) {
  throw new Error("schema-basic is expected to provide a link mark");
}
const markSpecs = basicSchema.spec.marks
  .update("link", {
    ...baseLinkSpec,
    attrs: {
      href: { default: "" },
      title: { default: null },
      displayTitle: { default: null },
      favicon: { default: null },
      siteName: { default: null },
    },
    inclusive: false,
    parseDOM: [
      {
        tag: "a[href]",
        getAttrs(dom) {
          if (typeof dom === "string") return null;
          return {
            href: dom.getAttribute("href") ?? "",
            title: dom.getAttribute("title"),
            displayTitle: dom.getAttribute("data-display-title"),
            favicon: dom.getAttribute("data-favicon"),
            siteName: dom.getAttribute("data-site-name"),
          };
        },
      },
    ],
    toDOM(mark) {
      const attrs = mark.attrs as {
        href: string;
        title: string | null;
        displayTitle: string | null;
        favicon: string | null;
        siteName: string | null;
      };
      const out: Record<string, string> = { href: attrs.href };
      if (attrs.title) out.title = attrs.title;
      // Carry the cache fields in data-* so a round-trip through the DOM
      // (copy/paste, undo replay) preserves them without polluting the
      // rendered <a> attributes that browsers care about.
      if (attrs.displayTitle) out["data-display-title"] = attrs.displayTitle;
      if (attrs.favicon) out["data-favicon"] = attrs.favicon;
      if (attrs.siteName) out["data-site-name"] = attrs.siteName;
      return ["a", out, 0];
    },
  })
  .addToEnd("strikethrough", {
    parseDOM: [
      { tag: "s" },
      { tag: "del" },
      { tag: "strike" },
      { style: "text-decoration=line-through" },
    ],
    toDOM() {
      return ["s", 0];
    },
  })
  // Underline. (`schema-basic` ships strong/em/code/link but not underline.)
  .addToEnd("underline", {
    parseDOM: [{ tag: "u" }, { style: "text-decoration=underline" }],
    toDOM() {
      return ["u", 0];
    },
  })
  // Note anchor: marks the text a shared note is attached to, carrying the note
  // `id` that links it to its `note_entry` body in the notes_index. `inclusive:
  // false` so typing at either edge doesn't extend the anchor. The note-anchors
  // plugin draws the clickable inline icon at the end of each marked range.
  .addToEnd("note", {
    attrs: { id: { default: "" } },
    inclusive: false,
    parseDOM: [
      {
        tag: "span[data-note-id]",
        getAttrs(dom) {
          if (typeof dom === "string") return null;
          return { id: dom.getAttribute("data-note-id") ?? "" };
        },
      },
    ],
    toDOM(mark) {
      const id = (mark.attrs as { id: string }).id;
      return ["span", { "data-note-id": id, class: "note-ref" }, 0];
    },
  })
  // Small caps for the covenant name (LORD/GOD) in inserted scripture, matching
  // printed ESV typography. Applied only by scripture insertion, not the toolbar.
  .addToEnd("small_caps", {
    parseDOM: [{ tag: "span.divine-name" }],
    toDOM() {
      return ["span", { class: "divine-name" }, 0];
    },
  })
  // Highlight (background) + text colour. Shared document formatting (they ride
  // the step log / version history like any other mark). The colour is a raw
  // value (an oklch() literal from format-colors.ts) baked into the inline
  // `style`, so the doc renders identically in the editor, the read-only viewer,
  // and history previews — none of which carry app/theme context. `inclusive:
  // false` stops the colour bleeding onto text typed right after the run.
  // Only palette values ever reach `color` (the command + normalizer enforce
  // the allow-list), which is also what keeps the inline style injection-safe.
  .addToEnd("highlight", {
    attrs: { color: { default: "" } },
    inclusive: false,
    parseDOM: [
      {
        tag: "mark[data-highlight]",
        getAttrs(dom) {
          if (typeof dom === "string") return null;
          return { color: dom.getAttribute("data-color") ?? "" };
        },
      },
    ],
    toDOM(mark) {
      const color = (mark.attrs as { color: string }).color;
      const custom = color !== "" && !isHighlightColor(color);
      return [
        "mark",
        {
          "data-highlight": "true",
          "data-color": color,
          ...(custom ? { "data-custom": "true" } : {}),
          style: colorMarkStyle("background-color", color),
        },
        0,
      ];
    },
  })
  .addToEnd("text_color", {
    attrs: { color: { default: "" } },
    inclusive: false,
    parseDOM: [
      {
        tag: "span[data-text-color]",
        getAttrs(dom) {
          if (typeof dom === "string") return null;
          return { color: dom.getAttribute("data-color") ?? "" };
        },
      },
    ],
    toDOM(mark) {
      const color = (mark.attrs as { color: string }).color;
      const custom = color !== "" && !isTextColor(color);
      return [
        "span",
        {
          "data-text-color": "true",
          "data-color": color,
          ...(custom ? { "data-custom": "true" } : {}),
          style: colorMarkStyle("color", color),
        },
        0,
      ];
    },
  })
  // Cross-reference chip. Wraps a typed scripture reference (e.g. "John 3:16",
  // "Romans 8:28-30") with the parsed canonical reference attrs. Applied by the
  // cross-ref-detect plugin (gated on the `crossRefAutoDetect` editor tool):
  // while the cursor is inside the range, `committed` is false and the chip
  // grows/contracts with each keystroke; once the user moves on, `committed`
  // flips to true and the underlying text is rewritten to the canonical form.
  // `excludes: "code"` so refs inside the inline code mark are skipped.
  // `inclusive: false` keeps typing past either edge from extending the chip.
  // Persists in the doc like any other mark, so read-only viewers and history
  // previews render the same pill without needing the detector to be present.
  .addToEnd("crossRef", {
    attrs: {
      book: { default: 0 },
      startChapter: { default: 0 },
      startVerse: { default: 0 },
      endChapter: { default: 0 },
      endVerse: { default: 0 },
      raw: { default: "" },
      committed: { default: false },
    },
    inclusive: false,
    excludes: "code",
    parseDOM: [
      {
        tag: "span[data-cross-ref]",
        getAttrs(dom) {
          if (typeof dom === "string") return null;
          const num = (name: string): number => {
            const v = Number(dom.getAttribute(name) ?? "0");
            return Number.isFinite(v) ? v : 0;
          };
          return {
            book: num("data-book"),
            startChapter: num("data-start-chapter"),
            startVerse: num("data-start-verse"),
            endChapter: num("data-end-chapter"),
            endVerse: num("data-end-verse"),
            raw: dom.getAttribute("data-raw") ?? "",
            // Anything that round-trips through the DOM is by definition
            // committed — only the live editor instance ever holds the
            // pre-commit transient state.
            committed: true,
          };
        },
      },
    ],
    toDOM(mark) {
      const attrs = mark.attrs as {
        book: number;
        startChapter: number;
        startVerse: number;
        endChapter: number;
        endVerse: number;
        raw: string;
        committed: boolean;
      };
      // Visual + interactive only when committed. While the user is actively
      // typing a reference, the mark exists silently on the text — no pill,
      // no click target — so the chip "appears" once the user has clearly
      // moved on (typed a space, clicked away). Re-editing a committed chip
      // keeps it committed: the pill stays visible, the surrounding text
      // never shifts. (Class joined via array to sidestep the Tailwind
      // class linter, which would try to validate the custom class.)
      if (!attrs.committed) {
        return ["span", 0];
      }
      const classes = ["cross-ref", "chip"].join("-");
      return [
        "span",
        {
          "data-cross-ref": "true",
          "data-book": String(attrs.book),
          "data-start-chapter": String(attrs.startChapter),
          "data-start-verse": String(attrs.startVerse),
          "data-end-chapter": String(attrs.endChapter),
          "data-end-verse": String(attrs.endVerse),
          // Always present (even when empty) so the click handler can read
          // `dataset.raw` without a possibly-undefined fallback that the
          // linter flags as unreachable under DOM types.
          "data-raw": attrs.raw,
          class: classes,
        },
        0,
      ];
    },
  });

export const schema = new Schema({ nodes: nodeSpecs, marks: markSpecs });

function requireNode(name: string): NodeType {
  const type = schema.nodes[name];
  if (!type) {
    throw new Error(`Editor schema is missing node type "${name}"`);
  }
  return type;
}

function requireMark(name: string): MarkType {
  const type = schema.marks[name];
  if (!type) {
    throw new Error(`Editor schema is missing mark type "${name}"`);
  }
  return type;
}

/**
 * Resolved node types. Resolving them once here gives non-nullable handles
 * (vs. the `NodeType | undefined` you get indexing `schema.nodes` under
 * `noUncheckedIndexedAccess`) and validates the schema at module load.
 */
export const nodes = {
  doc: requireNode("doc"),
  paragraph: requireNode("paragraph"),
  heading: requireNode("heading"),
  blockquote: requireNode("blockquote"),
  codeBlock: requireNode("code_block"),
  horizontalRule: requireNode("horizontal_rule"),
  hardBreak: requireNode("hard_break"),
  image: requireNode("image"),
  verseNumber: requireNode("verse_number"),
  scripture: requireNode("scripture"),
  studyBlock: requireNode("study_block"),
  listRow: requireNode("list_row"),
  callout: requireNode("callout"),
  collapsible: requireNode("collapsible"),
  noteEntry: requireNode("note_entry"),
  notesIndex: requireNode("notes_index"),
  table: requireNode("table"),
  tableRow: requireNode("table_row"),
  tableCell: requireNode("table_cell"),
  tableHeader: requireNode("table_header"),
} as const;

/**
 * Attrs carried on the `link` mark. `href` is the only required value; the
 * cache fields are populated by the hover preview plugin (or by the smart-
 * paste flow when pasting a bare URL) and read by the LinkPreviewCard.
 */
export interface LinkAttrs {
  href: string;
  /** Standard HTML `title` attribute (hover tooltip). Almost never set. */
  title: string | null;
  /** Cached page title — what the hover card renders bold. */
  displayTitle: string | null;
  /** Cached favicon URL — small icon shown in the hover card / fallback. */
  favicon: string | null;
  /** Cached `og:site_name`. */
  siteName: string | null;
}

/** Resolved mark types (see {@link nodes}). */
export const marks = {
  strong: requireMark("strong"),
  em: requireMark("em"),
  code: requireMark("code"),
  strikethrough: requireMark("strikethrough"),
  underline: requireMark("underline"),
  // `link` ships with `schema-basic` (attrs: href, title); surfaced here.
  link: requireMark("link"),
  smallCaps: requireMark("small_caps"),
  highlight: requireMark("highlight"),
  textColor: requireMark("text_color"),
  note: requireMark("note"),
  crossRef: requireMark("crossRef"),
} as const;
