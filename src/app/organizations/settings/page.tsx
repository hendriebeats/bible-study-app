import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OrgBrandingForm } from "@/components/organizations/org-branding-form";
import { OrgIconUpload } from "@/components/organizations/org-icon-upload";
import { OrgSettingsControls } from "@/components/organizations/org-settings-controls";
import { VerificationForm } from "@/components/organizations/verification-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getMyMembership, getMyOrg } from "@/lib/db/organizations";

export const metadata: Metadata = { title: "Organization · Settings" };

export default async function OrgSettingsPage() {
  const membership = await getMyMembership();
  if (!membership) {
    redirect("/organizations");
  }
  const isAdmin =
    membership.role === "admin" || membership.role === "super_admin";
  if (!isAdmin) {
    redirect("/organizations");
  }

  const org = await getMyOrg();
  if (!org) {
    redirect("/organizations");
  }

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/organizations"
          className="text-ui text-muted-foreground hover:text-foreground"
        >
          ← Organization
        </Link>
        <h1 className="mt-2 text-title font-bold tracking-tight">Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            How your organization appears to members and in search.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <OrgIconUpload
            orgId={org.id}
            orgName={org.name}
            iconUrl={org.icon_url}
          />
          <OrgBrandingForm org={org} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Discovery</CardTitle>
          <CardDescription>
            Control whether people can find and join your organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrgSettingsControls
            orgId={org.id}
            visibility={org.visibility}
            joinPolicy={org.join_policy}
            verified={org.verification_status === "verified"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Verification</CardTitle>
          <CardDescription>
            Verified organizations can be listed publicly in search.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VerificationForm org={org} />
        </CardContent>
      </Card>
    </div>
  );
}
