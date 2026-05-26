import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OrgTemplateManager } from "@/components/organizations/org-template-manager";
import { TemplateLibraryControls } from "@/components/organizations/template-library-controls";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listGenres } from "@/lib/db/genres";
import { getMyMembership } from "@/lib/db/organizations";
import { getOrgBookContext, listOrgTemplates } from "@/lib/db/templates";

export const metadata: Metadata = { title: "Organization · Templates" };

export default async function OrgTemplatesPage() {
  const membership = await getMyMembership();
  if (!membership) {
    redirect("/organizations");
  }
  const isAdmin =
    membership.role === "admin" || membership.role === "super_admin";
  if (!isAdmin) {
    redirect("/organizations");
  }
  const orgId = membership.organizationId;

  const [ctx, templates, genres] = await Promise.all([
    getOrgBookContext(),
    listOrgTemplates(orgId),
    listGenres(),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/organizations"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Organization
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Shape what your members get when they create a study. Editing a
          template affects future studies only.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your templates</CardTitle>
          <CardDescription>
            Custom templates and per-book overrides. Open one to edit it in the
            normal editor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrgTemplateManager
            templates={templates}
            genres={genres}
            overriddenOrdinals={ctx.overriddenOrdinals}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default library</CardTitle>
          <CardDescription>
            Control whether members can use the app&rsquo;s default book
            templates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TemplateLibraryControls
            orgId={orgId}
            usesDefaults={ctx.usesDefaults}
            disabledOrdinals={ctx.disabledOrdinals}
            overriddenOrdinals={ctx.overriddenOrdinals}
          />
        </CardContent>
      </Card>
    </div>
  );
}
