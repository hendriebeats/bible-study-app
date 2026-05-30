"use server";

import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { normalizeUrl } from "@/lib/editor/commands";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * What the hover-link preview card consumes. Always present; missing/failed
 * fetches return `status !== "ok"` so the client can render the fallback UI
 * (favicon + URL + actions) without juggling exceptions.
 */
export interface LinkPreview {
  status: "ok" | "failed" | "unreachable" | "blocked";
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
  siteName: string | null;
}

const SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 1_048_576;
const USER_AGENT =
  "Mozilla/5.0 (compatible; ThresholdLinkPreview/1.0; +https://threshold.app)";

/** Hash the (already-normalized) URL into the cache key. */
function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

/**
 * Reject any address that targets the host's internal network. Cheap belt-and-
 * braces against SSRF probes — even though Supabase / Vercel runtimes don't
 * usually expose a useful internal network, the cost of being wrong here is
 * data exfiltration, so we err strict. IPv4 and IPv6 forms both checked.
 */
function isPrivateAddress(addr: string): boolean {
  const family = isIP(addr);
  if (family === 4) {
    const parts = addr.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return true;
    }
    const [a = 0, b = 0] = parts;
    if (a === 10) return true; // 10/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (family === 6) {
    const normalized = addr.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique-local
    if (normalized.startsWith("fe80")) return true; // link-local
    // IPv4-mapped (e.g. ::ffff:127.0.0.1) — recurse on the embedded v4.
    const mapped = /^::ffff:([0-9.]+)$/.exec(normalized);
    if (mapped) {
      return isPrivateAddress(mapped[1] ?? "");
    }
    return false;
  }
  return false;
}

/**
 * Resolve a hostname and require every returned address to be public. Both
 * families are checked so a dual-stacked host can't sneak through with a
 * private AAAA record. Hostnames that fail to resolve are also "blocked" from
 * our POV — we don't want to leak the user's URL to anything weird.
 */
async function isSafeHost(hostname: string): Promise<boolean> {
  // A literal IP in the URL: short-circuit DNS and check directly.
  if (isIP(hostname)) {
    return !isPrivateAddress(hostname);
  }
  try {
    const addrs = await dnsLookup(hostname, { all: true });
    if (addrs.length === 0) return false;
    return addrs.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}

/** Decode HTML entities the small set that matter inside OG meta values. */
function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _match;
    });
}

/**
 * Pull the `content` value out of the first `<meta>` tag matching `predicate`.
 * Hand-rolled (instead of a parser dep) because we only need a few fields and
 * meta tag shape is well-bounded — quoted attrs, single line.
 */
function extractMeta(html: string, predicate: RegExp): string | null {
  const tagRe = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const tag = match[0];
    if (!predicate.test(tag)) continue;
    const content = /content=("([^"]*)"|'([^']*)')/i.exec(tag);
    if (!content) continue;
    const raw = content[2] ?? content[3] ?? "";
    if (raw === "") continue;
    return decodeEntities(raw).trim();
  }
  return null;
}

/** First-match helper across an ordered list of meta predicates. */
function pickMeta(html: string, predicates: RegExp[]): string | null {
  for (const pred of predicates) {
    const value = extractMeta(html, pred);
    if (value !== null && value !== "") return value;
  }
  return null;
}

/** Parse the `<title>` element's text. */
function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match?.[1]) return null;
  const text = decodeEntities(match[1].replace(/\s+/g, " ")).trim();
  return text === "" ? null : text;
}

/** Find the first usable favicon `<link rel="...icon...">`. */
function extractFavicon(html: string, base: URL): string | null {
  const linkRe = /<link\b[^>]*>/gi;
  let best: { url: string; rank: number } | null = null;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) !== null) {
    const tag = match[0];
    const rel = /\brel=("([^"]*)"|'([^']*)')/i.exec(tag);
    const relValue = (rel?.[2] ?? rel?.[3] ?? "").toLowerCase();
    if (!relValue.includes("icon")) continue;
    const href = /\bhref=("([^"]*)"|'([^']*)')/i.exec(tag);
    const hrefValue = href?.[2] ?? href?.[3];
    if (!hrefValue) continue;
    // Crude preference: apple-touch > shortcut > icon. (Higher = better.)
    const rank = relValue.includes("apple")
      ? 3
      : relValue.includes("shortcut")
        ? 2
        : 1;
    if (!best || rank > best.rank) {
      best = { url: hrefValue, rank };
    }
  }
  const candidate = best?.url ?? "/favicon.ico";
  try {
    return new URL(candidate, base).toString();
  } catch {
    return null;
  }
}

/** Parse the response body as HTML and extract preview fields. */
function parsePreview(
  finalUrl: URL,
  html: string,
): Omit<LinkPreview, "status" | "url"> {
  const title =
    pickMeta(html, [
      /property=("|')og:title\1/i,
      /name=("|')twitter:title\1/i,
    ]) ?? extractTitle(html);

  const description = pickMeta(html, [
    /property=("|')og:description\1/i,
    /name=("|')twitter:description\1/i,
    /name=("|')description\1/i,
  ]);

  const rawImage = pickMeta(html, [
    /property=("|')og:image:secure_url\1/i,
    /property=("|')og:image\1/i,
    /name=("|')twitter:image\1/i,
  ]);
  let imageUrl: string | null = null;
  if (rawImage) {
    try {
      imageUrl = new URL(rawImage, finalUrl).toString();
    } catch {
      imageUrl = null;
    }
  }

  const siteName = pickMeta(html, [/property=("|')og:site_name\1/i]);

  const faviconUrl = extractFavicon(html, finalUrl);

  return { title, description, imageUrl, faviconUrl, siteName };
}

/** Read up to `MAX_BYTES` of the body, then close the stream. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let received = 0;
  let html = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    html += decoder.decode(value, { stream: true });
    if (received >= MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  html += decoder.decode();
  return html;
}

/**
 * Build a {@link LinkPreview} for a row read from the cache (we trust columns
 * to roughly match the type — column constraints + the server-only writer keep
 * unknown statuses out, so any drift is a programming bug, not data).
 */
function rowToPreview(row: {
  url: string;
  status: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  favicon_url: string | null;
  site_name: string | null;
}): LinkPreview {
  return {
    status: row.status as LinkPreview["status"],
    url: row.url,
    title: row.title,
    description: row.description,
    imageUrl: row.image_url,
    faviconUrl: row.favicon_url,
    siteName: row.site_name,
  };
}

/** Upsert the preview, then return the freshly-shaped {@link LinkPreview}. */
async function writeCache(
  hash: string,
  url: string,
  status: LinkPreview["status"],
  data: Omit<LinkPreview, "status" | "url">,
): Promise<LinkPreview> {
  const admin = createAdminClient();
  const ttl = status === "ok" ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  await admin.from("link_previews").upsert(
    {
      url_hash: hash,
      url,
      status,
      title: data.title,
      description: data.description,
      image_url: data.imageUrl,
      favicon_url: data.faviconUrl,
      site_name: data.siteName,
      fetched_at: new Date().toISOString(),
      expires_at: expiresAt,
    },
    { onConflict: "url_hash" },
  );
  return { status, url, ...data };
}

/**
 * Look up (or fetch + cache) OG metadata for a URL. Called from the editor's
 * hover plugin AND from the link-paste smart-paste flow (which uses `title` as
 * link display text when pasting onto a bare cursor).
 *
 * Contract: never throws. Any failure produces a `LinkPreview` with a non-ok
 * status so the card's fallback layout always has something to render.
 */
export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview> {
  // Cheap gate: previews are only for signed-in users so we don't get spidered
  // by an unauthenticated client looping a worker through us as a free proxy.
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return {
      status: "blocked",
      url: rawUrl,
      title: null,
      description: null,
      imageUrl: null,
      faviconUrl: null,
      siteName: null,
    };
  }

  const normalized = normalizeUrl(rawUrl);
  if (!normalized) {
    return {
      status: "blocked",
      url: rawUrl,
      title: null,
      description: null,
      imageUrl: null,
      faviconUrl: null,
      siteName: null,
    };
  }

  // mailto: / tel: are valid links but have no fetchable preview — short-circuit.
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return {
      status: "blocked",
      url: normalized,
      title: null,
      description: null,
      imageUrl: null,
      faviconUrl: null,
      siteName: null,
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      status: "blocked",
      url: normalized,
      title: null,
      description: null,
      imageUrl: null,
      faviconUrl: null,
      siteName: null,
    };
  }

  const hash = hashUrl(normalized);

  // Cache lookup. We use the admin client only for writes; reads go through
  // the RLS-protected user client (allowed by the "authenticated read" policy)
  // so we don't accidentally surface internal columns.
  const { data: cached } = await supabase
    .from("link_previews")
    .select(
      "url, status, title, description, image_url, favicon_url, site_name, expires_at",
    )
    .eq("url_hash", hash)
    .maybeSingle();

  if (cached && new Date(cached.expires_at).getTime() > Date.now()) {
    return rowToPreview(cached);
  }

  // SSRF guard on the original host AND any redirect target (re-checked below).
  if (!(await isSafeHost(parsed.hostname))) {
    return await writeCache(hash, normalized, "blocked", {
      title: null,
      description: null,
      imageUrl: null,
      faviconUrl: null,
      siteName: null,
    });
  }

  // Fetch with a hard timeout. `redirect: "follow"` lets us land on the final
  // URL cheaply; we re-validate its host before parsing the body.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(normalized, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en",
      },
    });
  } catch {
    clearTimeout(timer);
    return await writeCache(hash, normalized, "unreachable", {
      title: null,
      description: null,
      imageUrl: null,
      faviconUrl: null,
      siteName: null,
    });
  }
  clearTimeout(timer);

  // Re-validate final URL post-redirect.
  let finalUrl: URL;
  try {
    finalUrl = new URL(response.url);
  } catch {
    finalUrl = parsed;
  }
  if (finalUrl.hostname !== parsed.hostname) {
    if (!(await isSafeHost(finalUrl.hostname))) {
      return await writeCache(hash, normalized, "blocked", {
        title: null,
        description: null,
        imageUrl: null,
        faviconUrl: null,
        siteName: null,
      });
    }
  }

  if (!response.ok) {
    return await writeCache(hash, normalized, "failed", {
      title: null,
      description: null,
      imageUrl: null,
      faviconUrl: null,
      siteName: null,
    });
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("xhtml")) {
    // Non-HTML (PDF, image, json): we can't parse OG but we can at least
    // record favicon-by-convention so the card renders meaningfully.
    return await writeCache(hash, normalized, "ok", {
      title: finalUrl.hostname,
      description: null,
      imageUrl: null,
      faviconUrl: `${finalUrl.origin}/favicon.ico`,
      siteName: finalUrl.hostname,
    });
  }

  let html: string;
  try {
    html = await readCapped(response);
  } catch {
    return await writeCache(hash, normalized, "failed", {
      title: null,
      description: null,
      imageUrl: null,
      faviconUrl: null,
      siteName: null,
    });
  }

  const parsedPreview = parsePreview(finalUrl, html);
  return await writeCache(hash, normalized, "ok", parsedPreview);
}
