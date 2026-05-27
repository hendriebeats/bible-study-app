"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { OrgJoinPolicy, OrgRole, OrgVisibility } from "@/lib/db/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSiteURL } from "@/lib/url";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * For actions that previously redirected: return the destination so the client
 * navigates with the router. (A server-side redirect() throws NEXT_REDIRECT,
 * which an imperative `.catch` would surface as a spurious "NEXT_REDIRECT" toast.)
 */
export type NavResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

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
): Promise<NavResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("create_organization", {
    _name: name,
    _description: description,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations");
  return { ok: true, path: "/organizations" };
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
    website: string;
    contactEmail: string;
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
      website: fields.website.trim() || null,
      contact_email: fields.contactEmail.trim() || null,
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

/** Submit for verification (admins) -> status 'pending'. Identity comes from
 * the org profile; only an optional note is collected here. */
export async function submitOrgVerification(
  note: string,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("submit_org_verification", {
    _note: note.trim() === "" ? undefined : note.trim(),
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
}): Promise<NavResult> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("create_org_template", {
    _type: input.type,
    _book_ordinal: input.bookOrdinal ?? undefined,
    _name: input.name ?? undefined,
    _genre_id: input.genreId ?? undefined,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations/templates");
  return { ok: true, path: `/studies/${data}` };
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

/** Rename/describe an org template (updates the registry + backing study title). */
export async function updateOrgTemplateMeta(
  templateId: string,
  templateStudyId: string,
  name: string,
  description: string,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const clean = name.trim() || "Template";
  const { error } = await supabase
    .from("study_templates")
    .update({ name: clean, description: description.trim() || null })
    .eq("id", templateId);
  if (error) {
    return { ok: false, error: error.message };
  }
  const { error: titleError } = await supabase
    .from("studies")
    .update({ title: clean })
    .eq("id", templateStudyId);
  if (titleError) {
    return { ok: false, error: titleError.message };
  }
  revalidatePath("/organizations/templates");
  return { ok: true };
}

/**
 * Customize a book for the org: clear any "disabled" state, create an override
 * template, and open it in the editor. (A book is never both disabled + override.)
 */
export async function customizeOrgBook(
  orgId: string,
  bookOrdinal: number,
): Promise<NavResult> {
  const { supabase } = await requireUser();
  await supabase
    .from("org_disabled_book_templates")
    .delete()
    .eq("organization_id", orgId)
    .eq("book_ordinal", bookOrdinal);
  const { data, error } = await supabase.rpc("create_org_template", {
    _type: "book",
    _book_ordinal: bookOrdinal,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/organizations/templates");
  return { ok: true, path: `/studies/${data}` };
}

/** Reset a book to the app default: drop any override + re-enable it. */
export async function resetOrgBook(
  orgId: string,
  bookOrdinal: number,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { data: override } = await supabase
    .from("study_templates")
    .select("template_study_id")
    .eq("organization_id", orgId)
    .eq("type", "book")
    .eq("book_ordinal", bookOrdinal)
    .maybeSingle();
  if (override) {
    const { error } = await supabase
      .from("studies")
      .delete()
      .eq("id", override.template_study_id);
    if (error) {
      return { ok: false, error: error.message };
    }
  }
  const { error: enableError } = await supabase
    .from("org_disabled_book_templates")
    .delete()
    .eq("organization_id", orgId)
    .eq("book_ordinal", bookOrdinal);
  if (enableError) {
    return { ok: false, error: enableError.message };
  }
  revalidatePath("/organizations/templates");
  return { ok: true };
}

/** Reorder an org custom template (up/down) — sets the order members see. */
export async function moveOrgTemplate(
  templateId: string,
  direction: "up" | "down",
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { data: target, error: targetError } = await supabase
    .from("study_templates")
    .select("organization_id, type")
    .eq("id", templateId)
    .maybeSingle();
  if (targetError) {
    return { ok: false, error: targetError.message };
  }
  if (target?.type !== "custom" || !target.organization_id) {
    return { ok: false, error: "Not a reorderable template." };
  }

  const { data: siblings, error: sibsError } = await supabase
    .from("study_templates")
    .select("id")
    .eq("organization_id", target.organization_id)
    .eq("type", "custom")
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (sibsError) {
    return { ok: false, error: sibsError.message };
  }

  const ids = siblings.map((s) => s.id);
  const idx = ids.indexOf(templateId);
  const swap = direction === "up" ? idx - 1 : idx + 1;
  const a = ids[idx];
  const b = ids[swap];
  if (a === undefined || b === undefined) {
    return { ok: true };
  }
  ids[idx] = b;
  ids[swap] = a;

  // Write sequential positions (normalizes any ties from older rows).
  const results = await Promise.all(
    ids.map((id, i) =>
      supabase.from("study_templates").update({ position: i }).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return { ok: false, error: failed.error.message };
  }
  revalidatePath("/organizations/templates");
  return { ok: true };
}

/**
 * Persist an explicit order for an org's custom templates (drag-to-reorder).
 * `orderedIds` must be the full set of that org's custom templates in the
 * desired order; positions are rewritten to 0…n-1. Validates every id is a
 * custom template in a single organization before writing (RLS still gates the
 * caller's right to update them).
 */
export async function reorderOrgTemplates(
  orderedIds: string[],
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (orderedIds.length === 0) {
    return { ok: true };
  }
  const unique = new Set(orderedIds);
  if (unique.size !== orderedIds.length) {
    return { ok: false, error: "Duplicate templates in reorder." };
  }

  const { data: rows, error } = await supabase
    .from("study_templates")
    .select("id, organization_id, type")
    .in("id", orderedIds);
  if (error) {
    return { ok: false, error: error.message };
  }
  if (rows.length !== orderedIds.length) {
    return { ok: false, error: "Some templates no longer exist." };
  }
  const orgId = rows[0]?.organization_id ?? null;
  const sameOrgCustom = rows.every(
    (r) => r.type === "custom" && r.organization_id === orgId && orgId !== null,
  );
  if (!sameOrgCustom) {
    return { ok: false, error: "Not reorderable templates." };
  }

  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("study_templates").update({ position: i }).eq("id", id),
    ),
  );
  const failedWrite = results.find((r) => r.error);
  if (failedWrite?.error) {
    return { ok: false, error: failedWrite.error.message };
  }
  revalidatePath("/organizations/templates");
  return { ok: true };
}
