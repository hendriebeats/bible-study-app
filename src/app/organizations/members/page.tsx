import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { JoinRequestList } from "@/components/organizations/join-request-list";
import { OrgInvitePanel } from "@/components/organizations/org-invite-panel";
import { OrgMemberRoster } from "@/components/organizations/org-member-roster";
import {
  getMyMembership,
  listJoinRequests,
  listOrgInvitations,
  listOrgMembers,
} from "@/lib/db/organizations";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Organization · Members" };

export default async function OrgMembersPage() {
  const membership = await getMyMembership();
  if (!membership) {
    redirect("/organizations");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const orgId = membership.organizationId;
  const isAdmin =
    membership.role === "admin" || membership.role === "super_admin";
  const isSuperAdmin = membership.role === "super_admin";

  const members = await listOrgMembers(orgId);
  const [invitations, requests] = isAdmin
    ? await Promise.all([listOrgInvitations(orgId), listJoinRequests(orgId)])
    : [[], []];

  return (
    <div className="grid gap-8">
      <div>
        <Link
          href="/organizations"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Organization
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Members</h1>
      </div>

      <section>
        <OrgMemberRoster
          orgId={orgId}
          members={members}
          myRole={membership.role}
          meId={user.id}
        />
      </section>

      {isAdmin ? (
        <>
          <section className="grid gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Join requests
            </h2>
            <JoinRequestList requests={requests} />
          </section>

          <section className="grid gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Invite people
            </h2>
            <OrgInvitePanel
              orgId={orgId}
              invitations={invitations}
              canInviteAdmins={isSuperAdmin}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
