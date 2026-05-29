import { describe, expect, it } from "vitest";

import { isDocEmpty } from "@/lib/editor/doc-utils";
import { schema } from "@/lib/editor/schema";
import { jsonToDoc } from "@/lib/editor/serialize";

describe("isDocEmpty", () => {
  it("returns true for the schema's blank starting doc", () => {
    const doc = schema.topNodeType.createAndFill();
    if (!doc) {
      throw new Error("topNodeType.createAndFill returned null");
    }
    expect(isDocEmpty(doc)).toBe(true);
  });

  it("returns true for a doc that's a lone empty paragraph", () => {
    const doc = jsonToDoc({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(isDocEmpty(doc)).toBe(true);
  });

  it("returns false once the paragraph has text", () => {
    const doc = jsonToDoc({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      ],
    });
    expect(isDocEmpty(doc)).toBe(false);
  });

  it("returns false when there are multiple top-level blocks", () => {
    const doc = jsonToDoc({
      type: "doc",
      content: [{ type: "paragraph" }, { type: "paragraph" }],
    });
    expect(isDocEmpty(doc)).toBe(false);
  });

  it("returns false when the first child is not a paragraph", () => {
    const doc = jsonToDoc({
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1 } }],
    });
    expect(isDocEmpty(doc)).toBe(false);
  });
});
