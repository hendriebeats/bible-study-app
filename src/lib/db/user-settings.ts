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
