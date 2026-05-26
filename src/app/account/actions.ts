"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  type FormatRecents,
  normalizeFormatRecents,
} from "@/lib/editor/format-actions";
import {
  normalizeScriptureOptions,
  type ScriptureOptions,
} from "@/lib/scripture/options";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { getSiteURL } from "@/lib/url";

/** Form state for `useActionState`: shows a success or error message. */
export type ActionState =
  | { status: "success"; message: string }
  | { status: "error"; message: string }
  | undefined;

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  return { supabase, userId: user.id };
}

export async function updateProfile(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, userId } = await requireUser();
  const displayName = getString(formData, "displayName").trim();
  if (!displayName) {
    return { status: "error", message: "Display name can't be empty." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", userId);
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath("/", "layout");
  return { status: "success", message: "Profile updated." };
}

export async function changePassword(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();
  const current = getString(formData, "currentPassword");
  const password = getString(formData, "password");
  const confirm = getString(formData, "confirmPassword");

  if (password.length < 8) {
    return {
      status: "error",
      message: "New password must be at least 8 characters.",
    };
  }
  if (password !== confirm) {
    return { status: "error", message: "The new passwords don't match." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const hasPassword =
    user?.identities?.some((identity) => identity.provider === "email") ??
    false;

  // If the user already has a password, verify the current one first.
  if (hasPassword) {
    if (!current) {
      return { status: "error", message: "Enter your current password." };
    }
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user?.email ?? "",
      password: current,
    });
    if (verifyError) {
      return {
        status: "error",
        message: "Your current password is incorrect.",
      };
    }
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { status: "error", message: error.message };
  }
  return { status: "success", message: "Password updated." };
}

export async function changeEmail(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();
  const email = getString(formData, "email").trim();
  if (!email) {
    return { status: "error", message: "Enter a new email address." };
  }

  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: `${getSiteURL()}/auth/confirm` },
  );
  if (error) {
    return { status: "error", message: error.message };
  }
  return {
    status: "success",
    message: "Check your inbox to confirm the new email address.",
  };
}

/** Persist a new avatar URL (uploaded to Storage by the client). */
export async function updateAvatar(avatarUrl: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", userId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/", "layout");
}

/** Clear the avatar so we fall back to OAuth photo / initials. */
export async function removeAvatar(): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", userId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/", "layout");
}

/**
 * Persist the user's remembered scripture-insertion defaults. Normalizes the
 * incoming options (trust boundary) before upserting their single settings row.
 */
export async function saveScriptureOptions(
  options: ScriptureOptions,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, userId } = await requireUser();
  const clean = normalizeScriptureOptions(options);
  const { error } = await supabase
    .from("user_settings")
    .upsert(
      { user_id: userId, scripture_options: clean as unknown as Json },
      { onConflict: "user_id" },
    );
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Persist the user's recently-used formatting actions (the selection bubble's
 * quick action). Normalizes first (trust boundary + palette allow-list) before
 * upserting their single settings row.
 */
export async function saveFormatRecents(
  recents: FormatRecents,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, userId } = await requireUser();
  const clean = normalizeFormatRecents(recents);
  const { error } = await supabase
    .from("user_settings")
    .upsert(
      { user_id: userId, format_recents: clean as unknown as Json },
      { onConflict: "user_id" },
    );
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function signOutEverywhere(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function deleteAccount(): Promise<void> {
  const { userId } = await requireUser();

  // Service-role delete; FKs cascade from auth.users to the user's data.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(error.message);
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
