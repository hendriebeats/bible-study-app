/**
 * Image upload pipeline — the single entry point used by every insertion
 * path (slash menu, paste, drop, toolbar button, insert-dialog Upload tab,
 * insert-dialog From-URL tab, image-toolbar Replace).
 *
 * Two branches:
 *   - file/Blob   → run the local pipeline (cap → heic decode → animated-gif
 *                   short-circuit → canvas resize+webp → bucket upload).
 *   - external URL → delegate to the `fetch-image` edge function, which does
 *                    the equivalent server-side (with SSRF guard) and returns
 *                    the bucket public URL.
 *
 * Errors are surfaced via {@link imageErrorToast} — callers receive
 * `{ ok: false, error }` so the editor can swap a placeholder node's status
 * to "broken" without also showing a toast.
 */

import { createClient } from "@/lib/supabase/client";

import { imageError, type ImageError } from "./image-errors";

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 2048;
const WEBP_QUALITY = 0.85;

/** Content types our local pipeline can decode + re-encode. SVG is rejected
 *  separately (XSS surface); HEIC is decoded via lazy heic2any. Animated GIF
 *  is uploaded as-is so the animation survives. */
const REENCODE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface UploadInput {
  /** A user-supplied file or blob. Mutually exclusive with `url`. */
  file?: File | Blob;
  /** An external URL to fetch + re-host. Routes through the edge function. */
  url?: string;
  studyId: string;
  userId: string;
}

export interface UploadOk {
  ok: true;
  src: string;
  naturalW: number;
  naturalH: number;
}

export interface UploadErr {
  ok: false;
  error: ImageError;
}

export type UploadResult = UploadOk | UploadErr;

export async function uploadImage(input: UploadInput): Promise<UploadResult> {
  if (input.url) return uploadByUrl(input.url, input.studyId);
  if (input.file) return uploadByFile(input.file, input.studyId, input.userId);
  return { ok: false, error: imageError("unknown") };
}

// ---------------------------------------------------------------------------
// URL branch
// ---------------------------------------------------------------------------

async function uploadByUrl(
  url: string,
  studyId: string,
): Promise<UploadResult> {
  const supabase = createClient();
  interface FetchImageResponse {
    src?: string;
    naturalW?: number;
    naturalH?: number;
    error?: string;
    message?: string;
  }
  const response = await supabase.functions.invoke<FetchImageResponse>(
    "fetch-image",
    { body: { url, studyId } },
  );
  const error: { message: string } | null =
    (response.error as { message: string } | null | undefined) ?? null;
  const data: FetchImageResponse | null = response.data ?? null;
  if (error || !data || data.error || !data.src) {
    const code = data?.error
      ? (data.error as ImageError["code"])
      : "fetch_failed";
    return { ok: false, error: imageError(code, data?.message) };
  }
  // The edge function returns 0/0 — backfill dimensions client-side by
  // decoding the image once. Saves a server-side decoder dependency.
  const dims = await decodeDimensionsFromUrl(data.src);
  return {
    ok: true,
    src: data.src,
    naturalW: dims?.w ?? 0,
    naturalH: dims?.h ?? 0,
  };
}

// ---------------------------------------------------------------------------
// File branch
// ---------------------------------------------------------------------------

async function uploadByFile(
  rawFile: File | Blob,
  studyId: string,
  userId: string,
): Promise<UploadResult> {
  // 1. SVG reject — content-type sniff (avoids parsing).
  const type = (rawFile.type || "").toLowerCase();
  if (type === "image/svg+xml" || type === "image/svg") {
    return { ok: false, error: imageError("svg_rejected") };
  }

  // 2. Hard 10 MB cap on the INPUT. HEIC decoding can balloon a 4 MB file to
  // 12 MB after JPEG conversion — that's fine because the cap measures
  // what the user actually handed us, and the toast copy stays honest.
  if (rawFile.size > MAX_INPUT_BYTES) {
    return { ok: false, error: imageError("too_large") };
  }

  // 3. Unknown type with no MIME info → reject. Avoids uploading whatever
  // a misnamed `.exe` would be.
  const isHeic = type === "image/heic" || type === "image/heif";
  const isGif = type === "image/gif";
  const isReencodable = REENCODE_TYPES.has(type);
  if (!isHeic && !isGif && !isReencodable) {
    return { ok: false, error: imageError("wrong_type") };
  }

  // 4. HEIC: lazy-load the decoder so the ~1.5 MB WASM chunk only ships when
  // someone actually drops an iPhone photo. Output is a JPEG blob.
  let working: Blob = rawFile;
  let workingType = type;
  let outputExt = extForType(type);
  if (isHeic) {
    try {
      const { default: heic2any } = await import("heic2any");
      const converted = await heic2any({
        blob: rawFile,
        toType: "image/jpeg",
        quality: 0.9,
      });
      const decoded = Array.isArray(converted) ? converted[0] : converted;
      if (!decoded) {
        return { ok: false, error: imageError("heic_decode_failed") };
      }
      working = decoded;
      workingType = "image/jpeg";
      outputExt = "jpg";
    } catch {
      return { ok: false, error: imageError("heic_decode_failed") };
    }
  }

  // 5. Animated GIFs: skip the canvas re-encode (it would freeze the
  // animation). Static GIFs go through the re-encode path so they get
  // WebP-sized. Detection is a cheap header scan for multiple image
  // descriptors.
  let naturalW = 0;
  let naturalH = 0;
  if (isGif) {
    const animated = await isAnimatedGif(working);
    if (animated) {
      const dims = await decodeDimensionsFromBlob(working);
      naturalW = dims?.w ?? 0;
      naturalH = dims?.h ?? 0;
      // working stays as the original GIF blob; outputExt stays "gif".
    } else {
      const reenc = await reencodeWebp(working);
      if (!reenc) return { ok: false, error: imageError("decode_failed") };
      working = reenc.blob;
      workingType = "image/webp";
      outputExt = "webp";
      naturalW = reenc.w;
      naturalH = reenc.h;
    }
  } else if (isReencodable || workingType === "image/jpeg") {
    // 6. Standard re-encode: resize to ≤MAX_DIMENSION and emit WebP @0.85.
    const reenc = await reencodeWebp(working);
    if (!reenc) return { ok: false, error: imageError("decode_failed") };
    working = reenc.blob;
    workingType = "image/webp";
    outputExt = "webp";
    naturalW = reenc.w;
    naturalH = reenc.h;
  }

  // 7. Upload. RLS denies if the caller isn't the study owner — surface
  // that distinctly.
  const supabase = createClient();
  const imageId = crypto.randomUUID();
  const path = `${userId}/${studyId}/${imageId}.${outputExt}`;
  const { error: upErr } = await supabase.storage
    .from("study-images")
    .upload(path, working, { contentType: workingType, upsert: false });
  if (upErr) {
    if (/row-level security|new row violates/i.test(upErr.message)) {
      return { ok: false, error: imageError("not_authorized") };
    }
    return { ok: false, error: imageError("upload_failed", upErr.message) };
  }
  const { data: pub } = supabase.storage
    .from("study-images")
    .getPublicUrl(path);

  return { ok: true, src: pub.publicUrl, naturalW, naturalH };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extForType(t: string): string {
  switch (t) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/heic":
    case "image/heif":
      return "heic";
    default:
      return "bin";
  }
}

/** Resize-to-MAX_DIMENSION + WebP@0.85 via an off-screen canvas. Returns
 *  null on decode failure (e.g. corrupt image). */
async function reencodeWebp(
  blob: Blob,
): Promise<{ blob: Blob; w: number; h: number } | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();
  const out = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      (b) => {
        resolve(b);
      },
      "image/webp",
      WEBP_QUALITY,
    );
  });
  if (!out) return null;
  return { blob: out, w: targetW, h: targetH };
}

/** GIF format: after the global color table, each frame begins with an
 *  image descriptor (0x2C). Multiple descriptors → animated. We don't have
 *  to fully parse the file — a byte scan with a small budget is enough,
 *  since the second descriptor appears within the first few KB of any
 *  meaningfully-animated GIF. */
async function isAnimatedGif(blob: Blob): Promise<boolean> {
  const slice = blob.slice(0, Math.min(blob.size, 64 * 1024));
  const buf = new Uint8Array(await slice.arrayBuffer());
  let descriptors = 0;
  for (const byte of buf) {
    if (byte === 0x2c) {
      descriptors++;
      if (descriptors >= 2) return true;
    }
  }
  return false;
}

async function decodeDimensionsFromBlob(
  blob: Blob,
): Promise<{ w: number; h: number } | null> {
  try {
    const bm = await createImageBitmap(blob);
    const out = { w: bm.width, h: bm.height };
    bm.close();
    return out;
  } catch {
    return null;
  }
}

function decodeDimensionsFromUrl(
  url: string,
): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      resolve(null);
    };
    img.src = url;
  });
}
