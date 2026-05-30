import { Plugin, PluginKey, Selection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { imageErrorToast } from "../image-errors";
import { uploadImage, type UploadResult } from "../image-upload";
import { nodes } from "../schema";

/**
 * Image paste + drop interception.
 *
 * Three entry paths funnel into the same {@link uploadImage} pipeline so
 * everything ends up in the study-images bucket — no off-site `src` ever
 * lives in the doc:
 *
 *   1. Clipboard files (the classic screenshot paste).
 *   2. HTML clipboard with an `<img src="https://…">` element. PM's default
 *      paste parser would happily build an image node pointing at the
 *      external URL. We intercept BEFORE parse: if we see `<img>` in the
 *      HTML, we cancel the default paste, insert a placeholder, and call
 *      the `fetch-image` edge function to re-host.
 *   3. Desktop drag-and-drop of image files (HTML5 `drop` event). Resolves
 *      the drop position via `view.posAtCoords` so the image lands where the
 *      cursor was, not at the end of the doc.
 *
 * Placeholders use `src: "pending:{uuid}"` so we can find and patch the node
 * after upload completes, even if intervening edits shifted positions.
 */

interface ImagePasteOptions {
  studyId: string;
  userId: string;
}

const KEY = new PluginKey("image-paste");

export function imagePastePlugin(opts: ImagePasteOptions): Plugin {
  return new Plugin({
    key: KEY,
    props: {
      handlePaste(view, event) {
        const cd = event.clipboardData;
        if (!cd) return false;

        // 1. File items first — screenshot paste, drag-and-drop of files
        // from another app, etc.
        const files: File[] = [];
        for (const item of cd.items) {
          if (item.kind === "file" && item.type.startsWith("image/")) {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length > 0) {
          event.preventDefault();
          for (const file of files) {
            startUploadFile(view, file, opts);
          }
          return true;
        }

        // 2. HTML clipboard containing `<img>`. Intercept before PM's parser
        // round-trips the external URL into the doc.
        const html = cd.getData("text/html");
        if (html && /<img\b[^>]*\bsrc=/i.test(html)) {
          const urls = extractImgSrcs(html);
          if (urls.length > 0) {
            event.preventDefault();
            for (const url of urls) {
              startUploadUrl(view, url, opts);
            }
            return true;
          }
        }

        return false;
      },

      handleDOMEvents: {
        // 3. Drag-and-drop from the desktop. PM's own DOM-drop handling
        // would discard image files; we resolve the drop coordinate and
        // insert at that position.
        drop(view, event) {
          const dt = event.dataTransfer;
          if (!dt || dt.files.length === 0) return false;
          const files: File[] = [];
          for (const f of dt.files) {
            if (f.type.startsWith("image/")) files.push(f);
          }
          if (files.length === 0) return false;
          event.preventDefault();
          const pos = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          for (const file of files) {
            startUploadFile(view, file, opts, pos?.pos);
          }
          return true;
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function extractImgSrcs(html: string): string[] {
  const out: string[] = [];
  const re = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    if (url && /^https?:\/\//i.test(url)) out.push(url);
  }
  return out;
}

function insertPlaceholder(
  view: EditorView,
  at?: number,
): { placeholderSrc: string; insertedPos: number } | null {
  const placeholderSrc = `pending:${crypto.randomUUID()}`;
  const node = nodes.image.create({
    src: placeholderSrc,
    status: "uploading",
  });
  const { state } = view;
  const insertAt = at ?? state.selection.from;
  let tr = state.tr.insert(insertAt, node);
  // Move the selection past the inserted node so subsequent inserts (for
  // multiple-image paste) line up below it.
  tr = tr.setSelection(
    Selection.near(tr.doc.resolve(insertAt + node.nodeSize)),
  );
  view.dispatch(tr);
  return { placeholderSrc, insertedPos: insertAt };
}

function startUploadFile(
  view: EditorView,
  file: File,
  opts: ImagePasteOptions,
  at?: number,
): void {
  const inserted = insertPlaceholder(view, at);
  if (!inserted) return;
  void uploadImage({ file, studyId: opts.studyId, userId: opts.userId }).then(
    (result) => {
      finalizePlaceholder(view, inserted.placeholderSrc, result);
    },
  );
}

function startUploadUrl(
  view: EditorView,
  url: string,
  opts: ImagePasteOptions,
): void {
  const inserted = insertPlaceholder(view);
  if (!inserted) return;
  void uploadImage({ url, studyId: opts.studyId, userId: opts.userId }).then(
    (result) => {
      finalizePlaceholder(view, inserted.placeholderSrc, result);
    },
  );
}

/** Walk the doc looking for the placeholder image node by its unique pending
 *  src and either patch it with the upload result or mark it broken. We can't
 *  rely on the original position because intervening edits may have moved it. */
function finalizePlaceholder(
  view: EditorView,
  placeholderSrc: string,
  result: UploadResult,
): void {
  // The walker mutates this through the closure — wrapped in an object so
  // type-narrowing doesn't conclude the value can only ever be -1.
  const found = { pos: -1 };
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === "image" && node.attrs.src === placeholderSrc) {
      found.pos = pos;
      return false;
    }
    return true;
  });
  if (found.pos === -1) return; // user undid or deleted the placeholder
  const foundPos = found.pos;
  const node = view.state.doc.nodeAt(foundPos);
  if (!node) return;

  if (!result.ok) {
    imageErrorToast(result.error);
    // Mark broken so the NodeView shows a Retry placeholder rather than a
    // permanent spinner.
    view.dispatch(
      view.state.tr.setNodeMarkup(foundPos, undefined, {
        ...node.attrs,
        status: "broken",
      }),
    );
    return;
  }

  view.dispatch(
    view.state.tr.setNodeMarkup(foundPos, undefined, {
      ...node.attrs,
      src: result.src,
      naturalW: result.naturalW,
      naturalH: result.naturalH,
      status: "ready",
    }),
  );
}
