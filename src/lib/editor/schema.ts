import {
  type MarkType,
  type NodeSpec,
  type NodeType,
  Schema,
} from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";

/**
 * The single ProseMirror schema for every study document.
 *
 * It MUST be the only schema instance used by the editor, the read-only viewer,
 * diffing, and all step/doc (de)serialization: `Step.fromJSON` and
 * `Node.fromJSON` only accept JSON produced against this exact schema, and
 * persisted history would fail to deserialize against a forked one. Never
 * create another schema — extend this one here. (See plan Risk #5.)
 *
 * Feature parity with the previous Tiptap StarterKit editor: headings,
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
// horizontal_rule, hard_break, image, and the strong/em/code/link marks.
// Add the list nodes and a strikethrough mark to match the old feature set.
const baseNodeSpecs = addListNodes(
  basicSchema.spec.nodes,
  "paragraph block*",
  "block",
);

/**
 * Verse number: an inline ATOM rendered as a `<sup>` superscript. It carries
 * just the printed marker (`n`, e.g. "1" or "3:16") and no editable content, so
 * it can't be typed into. The verse-guard plugin keeps it from being deleted and
 * makes it "stick" to the following word; `selectable: false` stops it being
 * click/drag-selected on its own.
 */
const verseNumberSpec: NodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  attrs: {
    n: { default: "" },
  },
  parseDOM: [
    {
      tag: "sup.scripture-verse",
      getAttrs(dom) {
        if (typeof dom === "string") return null;
        return { n: dom.getAttribute("data-verse") ?? "" };
      },
    },
  ],
  toDOM(node) {
    const attr = (node.attrs as { n: string }).n;
    const n = typeof attr === "string" ? attr : "";
    return ["sup", { class: "scripture-verse", "data-verse": n }, n];
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
  },
  parseDOM: [
    {
      tag: "section[data-study-block]",
      contentElement: ".study-block-body",
      getAttrs(dom) {
        if (typeof dom === "string") return null;
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
    };
    return [
      "section",
      {
        "data-study-block": "true",
        "data-title": attrs.title,
        "data-subtitle": attrs.subtitle,
        "data-placeholder": attrs.placeholder,
        ...(attrs.lineageId === null
          ? {}
          : { "data-lineage-id": attrs.lineageId }),
        ...(attrs.templateId === null
          ? {}
          : { "data-template-id": attrs.templateId }),
        class: "study-block",
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

const nodeSpecs = baseNodeSpecs
  .addToEnd("verse_number", verseNumberSpec)
  .addToEnd("scripture", scriptureSpec)
  .addToEnd("study_block", studyBlockSpec);

const markSpecs = basicSchema.spec.marks
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
  // Small caps for the covenant name (LORD/GOD) in inserted scripture, matching
  // printed ESV typography. Applied only by scripture insertion, not the toolbar.
  .addToEnd("small_caps", {
    parseDOM: [{ tag: "span.divine-name" }],
    toDOM() {
      return ["span", { class: "divine-name" }, 0];
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
  bulletList: requireNode("bullet_list"),
  orderedList: requireNode("ordered_list"),
  listItem: requireNode("list_item"),
  verseNumber: requireNode("verse_number"),
  scripture: requireNode("scripture"),
  studyBlock: requireNode("study_block"),
} as const;

/** Resolved mark types (see {@link nodes}). */
export const marks = {
  strong: requireMark("strong"),
  em: requireMark("em"),
  code: requireMark("code"),
  strikethrough: requireMark("strikethrough"),
  smallCaps: requireMark("small_caps"),
} as const;
