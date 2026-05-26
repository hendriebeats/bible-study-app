"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { OrgJoinPolicy, OrgRole, OrgVisibility } from "@/lib/db/types";
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

/** Create an org (caller becomes its first super admin) and open it. */
export async function createOrganization(
  name: string,
  description: string,
): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("create_organization", {
    _name: name,
    _description: description,
  });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/organizations");
  redirect("/organizations");
}

/** Update an org's public profile (admins, by RLS). */
export async function updateOrgBranding(
  orgId: string,
  fields: {
    name: string;
    description: string;
    city: string;
    region: string;
    country: string;
  },
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("organizations")
    .update({
      name: fields.name.trim() || "Organization",
      description: fields.description.trim(),
      city: fields.city.trim() || null,
      region: fields.region.trim() || null,
      country: fields.country.trim() || null,
    })
    .eq("id", orgId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations");
  revalidatePath("/organizations/settings");
  return { ok: true };
}

/** Persist a freshly-uploaded org icon URL (admins, by RLS). */
export async function updateOrgIcon(
  orgId: string,
  iconUrl: string | null,
): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("organizations")
    .update({ icon_url: iconUrl })
    .eq("id", orgId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/organizations");
  revalidatePath("/organizations/settings");
}

export async function setOrgVisibility(
  orgId: string,
  visibility: OrgVisibility,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("organizations")
    .update({ visibility })
    .eq("id", orgId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations/settings");
  return { ok: true };
}

export async function setOrgJoinPolicy(
  orgId: string,
  joinPolicy: OrgJoinPolicy,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("organizations")
    .update({ join_policy: joinPolicy })
    .eq("id", orgId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations/settings");
  return { ok: true };
}

export interface CreateInvitationResult {
  link: string;
  emailed: boolean;
}

/** Create an org invitation: always returns a copy-link; emails new addresses. */
export async function createOrgInvitation(
  orgId: string,
  email: string,
  role: OrgRole,
): Promise<CreateInvitationResult> {
  const { supabase, userId } = await requireUser();
  const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
  const cleanEmail = email.trim() === "" ? null : email.trim();

  const { error } = await supabase.from("organization_invitations").insert({
    organization_id: orgId,
    email: cleanEmail,
    token,
    inviter_id: userId,
    role,
  });
  if (error) {
    throw new Error(error.message);
  }

  const link = `${getSiteURL()}/organizations/accept?token=${token}`;
  let emailed = false;
  if (cleanEmail) {
    try {
      const admin = createAdminClient();
      const next = encodeURIComponent(`/organizations/accept?token=${token}`);
      const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
        cleanEmail,
        { redirectTo: `${getSiteURL()}/auth/confirm?next=${next}` },
      );
      emailed = inviteError === null;
    } catch {
      emailed = false;
    }
  }

  revalidatePath("/organizations/members");
  return { link, emailed };
}

export async function revokeOrgInvitation(invitationId: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("organization_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/organizations/members");
}

/** Accept an org invitation; redirects to the org on success. */
export async function acceptOrgInvitation(
  token: string,
): Promise<{ ok: false; error: string } | undefined> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("accept_org_invitation", {
    _token: token,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations");
  redirect("/organizations");
}

export async function declineOrgInvitation(
  token: string,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("decline_org_invitation", {
    _token: token,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations");
  revalidatePath("/dashboard");
  return { ok: true };
}

export type JoinResult =
  | { ok: true; status: "joined" | "requested" }
  | { ok: false; error: string };

/** Request to join (or auto-join an open) public+verified org. */
export async function requestToJoinOrg(
  orgId: string,
  note: string,
): Promise<JoinResult> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("request_to_join_org", {
    _org: orgId,
    _note: note.trim() === "" ? undefined : note.trim(),
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations");
  revalidatePath("/organizations/search");
  return { ok: true, status: data === "joined" ? "joined" : "requested" };
}

export async function approveJoinRequest(
  requestId: string,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("approve_join_request", {
    _id: requestId,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations/members");
  return { ok: true };
}

export async function denyJoinRequest(
  requestId: string,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("deny_join_request", {
    _id: requestId,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations/members");
  return { ok: true };
}

/** Promote/demote a member. The last-super-admin guard reports PT409. */
export async function setOrgMemberRole(
  orgId: string,
  memberUserId: string,
  role: OrgRole,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("organization_members")
    .update({ role })
    .eq("organization_id", orgId)
    .eq("user_id", memberUserId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations/members");
  return { ok: true };
}

export async function removeOrgMember(
  orgId: string,
  memberUserId: string,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("organization_members")
    .delete()
    .eq("organization_id", orgId)
    .eq("user_id", memberUserId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations/members");
  return { ok: true };
}

export async function leaveOrganization(): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("organization_members")
    .delete()
    .eq("user_id", userId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Submit the verification dossier (admins) -> status 'pending'. */
export async function submitOrgVerification(fields: {
  officialName: string;
  website: string;
  contactEmail: string;
  note: string;
}): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("submit_org_verification", {
    _official_name: fields.officialName,
    _website: fields.website,
    _contact_email: fields.contactEmail,
    _note: fields.note,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations/settings");
  return { ok: true };
}

/** Post an announcement (admins); fans out a notification per member. */
export async function postOrgAnnouncement(body: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("post_org_announcement", {
    _body: body,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Dismiss an announcement banner for the current user. */
export async function dismissAnnouncement(
  announcementId: string,
): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("dismissed_announcements")
    .insert({ user_id: userId, announcement_id: announcementId });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Mark the caller's notifications read (all, or a subset). */
export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("mark_notifications_read", {
    _ids: ids && ids.length > 0 ? ids : undefined,
  });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/dashboard");
}

/** Toggle whether the org uses the app default template library (admins). */
export async function setOrgUseDefaultLibrary(
  orgId: string,
  value: boolean,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("organizations")
    .update({ use_default_template_library: value })
    .eq("id", orgId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations/templates");
  return { ok: true };
}

/** Disable/enable a specific default book template for the org (admins). */
export async function setOrgBookDisabled(
  orgId: string,
  bookOrdinal: number,
  disabled: boolean,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = disabled
    ? await supabase.from("org_disabled_book_templates").upsert(
        { organization_id: orgId, book_ordinal: bookOrdinal },
        {
          onConflict: "organization_id,book_ordinal",
          ignoreDuplicates: true,
        },
      )
    : await supabase
        .from("org_disabled_book_templates")
        .delete()
        .eq("organization_id", orgId)
        .eq("book_ordinal", bookOrdinal);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations/templates");
  return { ok: true };
}

/** Create an org custom template or per-book override; open it in the editor. */
export async function createOrgTemplate(input: {
  type: "book" | "custom";
  bookOrdinal?: number;
  name?: string;
  genreId?: string | null;
}): Promise<void> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("create_org_template", {
    _type: input.type,
    _book_ordinal: input.bookOrdinal ?? undefined,
    _name: input.name ?? undefined,
    _genre_id: input.genreId ?? undefined,
  });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/organizations/templates");
  redirect(`/studies/${data}`);
}

/** Delete an org template by its backing study (cascades the registry row). */
export async function deleteOrgTemplate(
  templateStudyId: string,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("studies")
    .delete()
    .eq("id", templateStudyId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations/templates");
  return { ok: true };
}
