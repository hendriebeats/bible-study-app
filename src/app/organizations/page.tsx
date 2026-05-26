import type { Metadata } from "next";
import { Building2, Layers, Search, Settings, Users } from "lucide-react";
import Link from "next/link";

import { AnnouncementComposer } from "@/components/organizations/announcement-composer";
import { MyOrgInvitations } from "@/components/organizations/my-org-invitations";
import { OrgStatusBadge } from "@/components/organizations/org-status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  getMyMembership,
  getMyOrg,
  listMyOrgInvitations,
  listOrgAnnouncements,
} from "@/lib/db/organizations";
import { getInitials } from "@/lib/avatar";

export const metadata: Metadata = { title: "Organization" };

export default async function OrganizationsPage() {
  const membership = await getMyMembership();

  // Not in an org: a landing page to create, search, or accept an invitation.
  if (!membership) {
    const invitations = await listMyOrgInvitations();
    return (
      <div className="grid gap-8">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="size-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Join a church or ministry to study together with shared templates,
            or start your own. You can belong to one organization at a time.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/organizations/create">
                <Building2 className="size-4" />
                Create an organization
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/organizations/search">
                <Search className="size-4" />
                Find an organization
              </Link>
            </Button>
          </div>
        </div>

        <MyOrgInvitations invitations={invitations} />
      </div>
    );
  }

  const isAdmin =
    membership.role === "admin" || membership.role === "super_admin";
  const [org, announcements] = await Promise.all([
    getMyOrg(),
    listOrgAnnouncements(membership.organizationId),
  ]);
  if (!org) {
    // Membership without a readable org row shouldn't happen; fail soft.
    return (
      <p className="text-muted-foreground">
        We couldn&apos;t load your organization.
      </p>
    );
  }

  const place = [org.city, org.region, org.country].filter(Boolean).join(", ");

  return (
    <div className="grid gap-8">
      <div className="flex items-start gap-4">
        <Avatar className="size-14 shrink-0 rounded-lg">
          {org.icon_url ? (
            <AvatarImage src={org.icon_url} alt={org.name} />
          ) : null}
          <AvatarFallback className="rounded-lg">
            {getInitials(org.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
            <OrgStatusBadge status={org.verification_status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {org.description}
          </p>
          {place ? (
            <p className="mt-1 text-xs text-muted-foreground">{place}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <Link href="/organizations/members">
            <Users className="size-4" />
            Members
          </Link>
        </Button>
        {isAdmin ? (
          <>
            <Button variant="outline" asChild>
              <Link href="/organizations/templates">
                <Layers className="size-4" />
                Templates
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/organizations/settings">
                <Settings className="size-4" />
                Settings
              </Link>
            </Button>
          </>
        ) : null}
      </div>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Announcements
        </h2>
        {isAdmin ? <AnnouncementComposer /> : null}
        {announcements.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            No announcements yet.
          </p>
        ) : (
          <ul className="grid gap-2">
            {announcements.map((a) => (
              <li key={a.id} className="rounded-lg border bg-card p-3 text-sm">
                <p className="whitespace-pre-wrap">{a.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(a.created_at).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
