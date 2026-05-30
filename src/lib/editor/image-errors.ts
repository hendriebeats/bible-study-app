/**
 * Centralized error taxonomy + toast formatter for the image pipeline.
 *
 * Every rejection path (oversize, wrong type, fetch failure, HEIC decode bust,
 * RLS denial, ...) routes through {@link imageErrorToast} so the user always
 * sees the same plain-English copy for the same condition. No "MIME", no
 * "XSS", no "RLS" — those leak product internals.
 *
 * Add new codes here (not at call sites) so the message stays in one place.
 */

import { toast } from "sonner";

export type ImageErrorCode =
  | "svg_rejected"
  | "wrong_type"
  | "too_large"
  | "invalid_url"
  | "blocked_host"
  | "timeout"
  | "fetch_failed"
  | "heic_decode_failed"
  | "decode_failed"
  | "not_authorized"
  | "upload_failed"
  | "auth_required"
  | "unknown";

export interface ImageError {
  code: ImageErrorCode;
  /**
   * Optional override message. Server-issued errors sometimes carry extra
   * context (e.g. the HTTP status from `fetch-image`) — let it through if
   * provided, otherwise fall back to the canonical copy.
   */
  message?: string;
}

const MESSAGES: Record<ImageErrorCode, string> = {
  svg_rejected: "SVG images aren't supported here.",
  wrong_type: "That file isn't a supported image type.",
  too_large: "Image is too large (max 10 MB).",
  invalid_url: "That doesn't look like a valid image URL.",
  blocked_host: "That URL isn't allowed.",
  timeout: "Image took too long to load.",
  fetch_failed: "Couldn't load that image. Check the URL and try again.",
  heic_decode_failed:
    "Couldn't open that HEIC image. Try saving it as JPEG or PNG first.",
  decode_failed: "Couldn't read that image file.",
  not_authorized: "You don't have permission to add images to this study.",
  upload_failed: "Couldn't save the image. Please try again.",
  auth_required: "Please sign in again to add images.",
  unknown: "Something went wrong with that image. Please try again.",
};

/** Format an error into a user-facing toast and return false (lets callers
 *  early-return with `return imageErrorToast(...);` from boolean-returning
 *  spots). */
export function imageErrorToast(err: ImageError): false {
  toast.error(err.message ?? MESSAGES[err.code]);
  return false;
}

/** Convenience constructor — `imageError("too_large")` instead of building the
 *  object literal each time. */
export function imageError(code: ImageErrorCode, message?: string): ImageError {
  return message ? { code, message } : { code };
}
