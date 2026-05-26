"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSiteURL } from "@/lib/url";

export type ActionResult = { ok: true } | { ok: false; error: string };

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

/** Create a group (+ its template study) and go to it. */
export async function createGroup(name: string): Promise<void> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("create_group_study", {
    _name: name,
  });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/groups");
  redirect(`/groups/${data}`);
}

export async function renameGroup(
  groupId: string,
  name: string,
): Promise<void> {
  const { supabase } = await requireUser();
  const clean = name.trim() || "Group study";
  const { error } = await supabase
    .from("group_studies")
    .update({ name: clean })
    .eq("id", groupId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/groups/${groupId}`);
  revalidatePath("/groups");
}

export async function deleteGroup(groupId: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("group_studies")
    .delete()
    .eq("id", groupId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/groups");
  redirect("/groups");
}

export interface CreateInvitationResult {
  link: string;
  emailed: boolean;
}

/** Create an invitation: always returns a copy-link; emails new addresses too. */
export async function createInvitation(
  groupId: string,
  email: string,
  role: "owner" | "member",
): Promise<CreateInvitationResult> {
  const { supabase, userId } = await requireUser();
  const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
  const cleanEmail = email.trim() === "" ? null : email.trim();

  const { error } = await supabase.from("invitations").insert({
    group_study_id: groupId,
    email: cleanEmail,
    token,
    inviter_id: userId,
    role,
  });
  if (error) {
    throw new Error(error.message);
  }

  const link = `${getSiteURL()}/groups/accept?token=${token}`;
  let emailed = false;
  if (cleanEmail) {
    try {
      const admin = createAdminClient();
      const next = encodeURIComponent(`/groups/accept?token=${token}`);
      const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
        cleanEmail,
        { redirectTo: `${getSiteURL()}/auth/confirm?next=${next}` },
      );
      emailed = inviteError === null;
    } catch {
      emailed = false;
    }
  }

  revalidatePath(`/groups/${groupId}`);
  return { link, emailed };
}

/**
 * Seed (or return) the current user's own study in a group from its template,
 * then open it. Lets a group owner — who starts with no contributed study —
 * join the study in parallel with members. Idempotent at the RPC level.
 */
export async function seedMyGroupStudy(groupId: string): Promise<void> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("seed_my_group_study", {
    _group_study_id: groupId,
  });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/groups/${groupId}`);
  redirect(`/studies/${data}`);
}

export async function revokeInvitation(
  invitationId: string,
  groupId: string,
): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/groups/${groupId}`);
}

/** Promote/demote a member. The last-owner guard (DB trigger) reports PT409. */
export async function setMemberRole(
  groupId: string,
  memberUserId: string,
  role: "owner" | "member",
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("group_study_members")
    .update({ role })
    .eq("group_study_id", groupId)
    .eq("user_id", memberUserId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath(`/groups/${groupId}`);
  return { ok: true };
}

export async function removeMember(
  groupId: string,
  memberUserId: string,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("group_study_members")
    .delete()
    .eq("group_study_id", groupId)
    .eq("user_id", memberUserId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath(`/groups/${groupId}`);
  return { ok: true };
}

export async function leaveGroup(groupId: string): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("group_study_members")
    .delete()
    .eq("group_study_id", groupId)
    .eq("user_id", userId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/groups");
  return { ok: true };
}

/**
 * Attach a study to the caller's "loose" membership in a group: either an
 * existing owned study (`studyId`) or a fresh seed from the group's template
 * (`null`). Resolves the notification prompt for groups with no study attached.
 */
export async function attachStudyToGroup(
  groupId: string,
  studyId: string | null,
): Promise<{ ok: false; error: string } | undefined> {
  const { supabase } = await requireUser();
  const { data: attachedStudyId, error } = await supabase.rpc(
    "attach_study_to_group",
    {
      _group_study_id: groupId,
      _study_id: studyId ?? undefined,
    },
  );
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/dashboard");
  revalidatePath("/groups");
  // Drop the user straight into the study they just attached/seeded.
  redirect(`/studies/${attachedStudyId}`);
}

/** Decline a pending invitation addressed to the current user. */
export async function declineInvitation(token: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("decline_invitation", { _token: token });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Accept an invitation: attach an existing study, or seed one from the template.
 * Returns an error result on failure (so the UI can show expired/invalid), and
 * redirects to the group on success.
 */
export async function acceptInvitation(
  token: string,
  studyId: string | null,
): Promise<{ ok: false; error: string } | undefined> {
  const { supabase, userId } = await requireUser();
  const { data: groupId, error } = await supabase.rpc("accept_invitation", {
    _token: token,
    _study_id: studyId ?? undefined,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/groups");
  // Land the user in their study within the group (the one they attached, or
  // the fresh seed). Fall back to the group if there's somehow no study.
  let targetStudyId = studyId;
  if (!targetStudyId) {
    const { data: membership } = await supabase
      .from("group_study_members")
      .select("study_id")
      .eq("group_study_id", groupId)
      .eq("user_id", userId)
      .maybeSingle();
    targetStudyId = membership?.study_id ?? null;
  }
  if (targetStudyId) {
    redirect(`/studies/${targetStudyId}`);
  }
  redirect(`/groups/${groupId}`);
}
