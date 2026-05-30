"use client";

import type { Node } from "prosemirror-model";
import { EditorState, Plugin } from "prosemirror-state";
import { type DecorationSet, EditorView } from "prosemirror-view";
import { useEffect, useRef } from "react";

import { buildNodeViews } from "@/lib/editor/node-views";
import { crossRefDetect } from "@/lib/editor/plugins/cross-ref-detect";
import { themedColors } from "@/lib/editor/plugins/themed-colors";
import { verseLabel } from "@/lib/editor/plugins/verse-label";
import { DEFAULT_EDITOR_TOOLS } from "@/lib/editor/editor-tools";

function makeState(doc: Node, decorations?: DecorationSet): EditorState {
  const plugins = [
    verseLabel(),
    // Per-theme overlay for custom-colour marks (mirrors the live editor's
    // wiring in document-editor.tsx). Read-only views still need this so
    // history previews stay legible after the user toggles themes.
    themedColors(),
    // Interaction-only mode (auto-detect off): persisted chips stay clickable
    // in history previews and diff views.
    crossRefDetect(DEFAULT_EDITOR_TOOLS),
    ...(decorations
      ? [new Plugin({ props: { decorations: () => decorations } })]
      : []),
  ];
  return EditorState.create({ doc, plugins });
}

/**
 * Read-only render of a ProseMirror document (a reconstructed past version or
 * a diff), with optional static decorations. Reuses one EditorView and updates
 * its state when the doc/decorations change, so scrubbing stays cheap.
 */
export function DocPreview({
  doc,
  decorations,
}: {
  doc: Node;
  decorations?: DecorationSet;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }
    const view = new EditorView(mount, {
      state: makeState(doc, decorations),
      editable: () => false,
      nodeViews: buildNodeViews(false),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Created once; later doc/decoration changes flow through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.updateState(makeState(doc, decorations));
  }, [doc, decorations]);

  return <div ref={mountRef} />;
}
