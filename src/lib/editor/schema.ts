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
 * block, horizontal rule, hard break. Plus two study-specific block nodes:
 *   * `scripture` — raw passage text (no marks; protected from free editing by
 *     an editor plugin; highlights live in a separate decoration layer). Carries
 *     its reference so a copy can be re-seeded as clean text.
 *   * `study_block` — a labeled work area (Observation/Interpretation/…) holding
 *     the user's editable content. `lineageId` is the shared "slot" that lets
 *     blocks line up across members' studies.
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
 * Scripture: a raw passage rendered as a single ATOM (a leaf with no editable
 * content). With no content, the verse text can't be typed into or corrupted —
 * users can only select/delete the whole passage (like an image). The raw ESV
 * text (with `[n]` verse markers) lives in the `text` attr; a NodeView renders
 * the markers as superscripts. reference/version/passageId travel as attrs so a
 * seeded copy can recreate clean text from the source.
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
 * Study block: a labeled, templated work area. `content: "block+"` holds the
 * user's editable paragraphs/lists; the label + prompt render as non-editable
 * chrome. `lineageId` is the cross-study slot; `templateId` records the genre
 * template it came from.
 */
const studyBlockSpec: NodeSpec = {
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  attrs: {
    label: { default: "" },
    prompt: { default: "" },
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
          label: dom.getAttribute("data-label") ?? "",
          prompt: dom.getAttribute("data-prompt") ?? "",
          lineageId: dom.getAttribute("data-lineage-id"),
          templateId: dom.getAttribute("data-template-id"),
        };
      },
    },
  ],
  toDOM(node) {
    const attrs = node.attrs as {
      label: string;
      prompt: string;
      lineageId: string | null;
      templateId: string | null;
    };
    return [
      "section",
      {
        "data-study-block": "true",
        "data-label": attrs.label,
        "data-prompt": attrs.prompt,
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
        { class: "study-block-label", contenteditable: "false" },
        attrs.label,
      ],
      ["div", { class: "study-block-body" }, 0],
    ];
  },
};

const nodeSpecs = baseNodeSpecs
  .addToEnd("scripture", scriptureSpec)
  .addToEnd("study_block", studyBlockSpec);

const markSpecs = basicSchema.spec.marks.addToEnd("strikethrough", {
  parseDOM: [
    { tag: "s" },
    { tag: "del" },
    { tag: "strike" },
    { style: "text-decoration=line-through" },
  ],
  toDOM() {
    return ["s", 0];
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
  scripture: requireNode("scripture"),
  studyBlock: requireNode("study_block"),
} as const;

/** Resolved mark types (see {@link nodes}). */
export const marks = {
  strong: requireMark("strong"),
  em: requireMark("em"),
  code: requireMark("code"),
  strikethrough: requireMark("strikethrough"),
} as const;
