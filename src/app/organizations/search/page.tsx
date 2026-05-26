import type { Metadata } from "next";
import Link from "next/link";

import { OrgSearch } from "@/components/organizations/org-search";
import { getMyMembership, listDiscoverableOrgs } from "@/lib/db/organizations";

export const metadata: Metadata = { title: "Find an organization" };

export default async function OrgSearchPage() {
  const [orgs, membership] = await Promise.all([
    listDiscoverableOrgs(),
    getMyMembership(),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/organizations"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Organizations
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Find an organization
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {membership
            ? "You already belong to an organization — leave it first to join another."
            : "Browse verified organizations. Some let you join instantly; others review requests."}
        </p>
      </div>

      <OrgSearch orgs={orgs} canJoin={!membership} />
    </div>
  );
}
