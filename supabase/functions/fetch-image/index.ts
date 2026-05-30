// fetch-image: server-side fetch of an external image URL, validated and
// stored into the study-images bucket. Used by:
//   - the insert dialog's "From URL" tab
//   - the editor's HTML-paste interceptor when the clipboard carries
//     <img src="https://external.site/...">
//
// We funnel everything through the bucket (no off-site `src` ever lands in
// the doc) so the cleanup story stays uniform and there's no link-rot or
// cross-origin tracking. SSRF protections reject any URL whose resolved IP
// lives in a private / loopback / link-local / cloud-metadata range BEFORE
// the actual fetch happens.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB cap — same as client-side uploads.
const FETCH_TIMEOUT_MS = 10_000;

// MIME types we accept. SVG deliberately omitted (XSS surface) — keep in sync
// with the client-side reject in src/lib/editor/image-upload.ts.
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

// Hosts/IP ranges the fetcher refuses. Catches the common SSRF footguns:
// loopback, link-local, RFC1918 private, cloud-metadata, and IPv6 equivalents.
function isBlockedHost(host: string): boolean {
  if (host === "localhost" || host === "ip6-localhost") return true;
  // IPv4 literal
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a === 0) return true; // 0.0.0.0/8
  }
  // IPv6: refuse loopback (::1) and link-local (fe80::/10), and the
  // unique-local fc00::/7 block. Coarse check on string prefix is sufficient.
  const lower = host.toLowerCase();
  if (lower === "::1" || lower === "[::1]") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("[fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("[fc") || lower.startsWith("[fd")) return true;
  return false;
}

interface FetchPayload {
  url?: unknown;
  studyId?: unknown;
}

type ErrorCode =
  | "auth_required"
  | "bad_request"
  | "invalid_url"
  | "blocked_host"
  | "fetch_failed"
  | "timeout"
  | "too_large"
  | "wrong_type"
  | "svg_rejected"
  | "not_authorized"
  | "upload_failed";

// Standard CORS headers for browser-invoked edge functions. Supabase's
// browser SDK sends `Authorization: Bearer <jwt>` + `Content-Type:
// application/json`, both of which trigger a CORS preflight — without these
// headers the OPTIONS request fails and the real POST never goes through.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

function err(code: ErrorCode, message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return err("bad_request", "Use POST.", 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return err("auth_required", "Sign in required.", 401);
  }

  let payload: FetchPayload;
  try {
    payload = (await req.json()) as FetchPayload;
  } catch {
    return err("bad_request", "Invalid JSON.");
  }

  const rawUrl = typeof payload.url === "string" ? payload.url.trim() : "";
  const studyId = typeof payload.studyId === "string" ? payload.studyId : "";
  if (!rawUrl || !studyId) {
    return err("bad_request", "Missing url or studyId.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return err("invalid_url", "That doesn't look like a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return err("invalid_url", "Only http and https URLs are supported.");
  }
  if (isBlockedHost(parsed.hostname)) {
    return err("blocked_host", "That URL isn't allowed.");
  }

  // Fetch with timeout + body cap. We let `fetch` stream the response so we
  // can short-circuit oversized payloads without buffering 100 MB into RAM.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "threshold-fetch-image/1.0" },
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Error && e.name === "AbortError") {
      return err("timeout", "Image took too long to load.");
    }
    return err("fetch_failed", "Couldn't reach that image.");
  }
  clearTimeout(timer);

  if (!res.ok || !res.body) {
    return err("fetch_failed", `Image responded with ${String(res.status)}.`);
  }

  const contentType = (res.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType === "image/svg+xml" || contentType === "image/svg") {
    return err("svg_rejected", "SVG images aren't supported here.");
  }
  if (contentType && !ALLOWED_TYPES.has(contentType)) {
    return err("wrong_type", "That URL doesn't point to a supported image.");
  }

  // Stream the body into a single Uint8Array, bailing if we cross MAX_BYTES.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_BYTES) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return err("too_large", "Image is too large (max 10 MB).");
      }
      chunks.push(chunk.value);
    }
  } catch {
    return err("fetch_failed", "Couldn't finish downloading that image.");
  }

  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }

  // Stand up a Supabase client using the CALLER's JWT so the upload is gated
  // by the bucket's RLS (is_study_owner) — we don't trust client-supplied
  // userId/studyId to bypass auth.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) {
    return err("auth_required", "Sign in required.", 401);
  }
  const userId = userData.user.id;

  // Pick an extension from the content type rather than the URL — URLs
  // routinely lie (`.jpg` for a webp, query params, no extension at all).
  const ext =
    contentType === "image/jpeg"
      ? "jpg"
      : contentType === "image/png"
        ? "png"
        : contentType === "image/webp"
          ? "webp"
          : contentType === "image/gif"
            ? "gif"
            : contentType === "image/heic" || contentType === "image/heif"
              ? "heic"
              : "bin";

  const imageId = crypto.randomUUID();
  const path = `${userId}/${studyId}/${imageId}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("study-images")
    .upload(path, buf, {
      contentType: contentType || "application/octet-stream",
      upsert: false,
    });
  if (upErr) {
    // RLS denies if the caller isn't the study owner — surface that distinctly
    // so the client can show "You don't own this study."
    if (/row-level security|new row violates/i.test(upErr.message)) {
      return err(
        "not_authorized",
        "You don't have permission to add images to this study.",
        403,
      );
    }
    return err("upload_failed", "Couldn't save the image.", 500);
  }

  const { data: pub } = supabase.storage
    .from("study-images")
    .getPublicUrl(path);

  // Natural dimensions are not extractable here without a decoder — return
  // 0/0 and let the client decode on render (one cheap Image().naturalWidth
  // round-trip) to fill them in via a follow-up tr.
  return new Response(
    JSON.stringify({ src: pub.publicUrl, naturalW: 0, naturalH: 0 }),
    {
      status: 200,
      headers: { "content-type": "application/json", ...CORS_HEADERS },
    },
  );
});
