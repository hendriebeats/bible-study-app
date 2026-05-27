import {
  DEFAULT_EDITOR_TOOLS,
  type EditorTools,
  normalizeEditorTools,
} from "@/lib/editor/editor-tools";
import {
  DEFAULT_FORMAT_RECENTS,
  type FormatRecents,
  normalizeFormatRecents,
} from "@/lib/editor/format-actions";
import {
  DEFAULT_SCRIPTURE_OPTIONS,
  normalizeScriptureOptions,
  type ScriptureOptions,
} from "@/lib/scripture/options";
import { createClient } from "@/lib/supabase/server";

/**
 * The current user's remembered scripture-insertion defaults. Falls back to
 * {@link DEFAULT_SCRIPTURE_OPTIONS} when the user is unauthenticated, has no
 * settings row yet, or the stored jsonb is an older/partial shape — so a stale
 * value never crashes the editor.
 */
export async function getScriptureOptions(): Promise<ScriptureOptions> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return DEFAULT_SCRIPTURE_OPTIONS;
  }
  const { data } = await supabase
    .from("user_settings")
    .select("scripture_options")
    .eq("user_id", user.id)
    .maybeSingle();
  return normalizeScriptureOptions(
    data?.scripture_options as Partial<ScriptureOptions> | null,
  );
}

/**
 * The current user's recently-used formatting actions (the bubble's quick
 * action). Falls back to {@link DEFAULT_FORMAT_RECENTS} when the user is
 * unauthenticated, has no settings row, or the stored jsonb is an older/partial
 * shape — and drops any entry whose colour isn't an allow-listed palette value.
 */
export async function getFormatRecents(): Promise<FormatRecents> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return DEFAULT_FORMAT_RECENTS;
  }
  const { data } = await supabase
    .from("user_settings")
    .select("format_recents")
    .eq("user_id", user.id)
    .maybeSingle();
  return normalizeFormatRecents(
    data?.format_recents as { actions?: unknown } | null,
  );
}

/**
 * The current user's opt-in editor tools. Falls back to
 * {@link DEFAULT_EDITOR_TOOLS} (all off) when unauthenticated, missing, or the
 * stored jsonb is an older/partial shape.
 */
export async function getEditorTools(): Promise<EditorTools> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return DEFAULT_EDITOR_TOOLS;
  }
  const { data } = await supabase
    .from("user_settings")
    .select("editor_tools")
    .eq("user_id", user.id)
    .maybeSingle();
  return normalizeEditorTools(data?.editor_tools);
}
