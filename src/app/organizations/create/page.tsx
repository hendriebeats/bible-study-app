import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { NewOrgForm } from "@/components/organizations/new-org-form";
import { getMyMembership } from "@/lib/db/organizations";

export const metadata: Metadata = { title: "Create an organization" };

export default async function CreateOrganizationPage() {
  // A user belongs to at most one org; if they're already in one, send them home.
  const membership = await getMyMembership();
  if (membership) {
    redirect("/organizations");
  }

  return (
    <div>
      <Link
        href="/organizations"
        className="text-ui text-muted-foreground hover:text-foreground"
      >
        ← Organizations
      </Link>
      <div className="mt-2 flex items-center gap-2">
        <Building2 className="size-5 text-primary" />
        <h1 className="text-title font-bold tracking-tight">
          Create an organization
        </h1>
      </div>
      <p className="mt-1 mb-6 text-ui text-muted-foreground">
        You&apos;ll be its first super admin. New organizations start private
        and unverified — submit for verification in settings to appear in
        search.
      </p>

      <NewOrgForm />
    </div>
  );
}
