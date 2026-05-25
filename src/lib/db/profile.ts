import type { Profile } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

/** The current user's profile, or null if not signed in. */
export async function getMyProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}
