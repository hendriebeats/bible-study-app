import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OrgBooksManager } from "@/components/organizations/org-books-manager";
import { OrgCustomTemplates } from "@/components/organizations/org-custom-templates";
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

  const [orgTemplates, genres, ctx] = await Promise.all([
    listOrgTemplates(orgId),
    listGenres(),
    getOrgBookContext(),
  ]);

  const customTemplates = orgTemplates.filter((t) => t.type === "custom");
  const overrides = orgTemplates.flatMap((t) =>
    t.type === "book" && t.book_ordinal !== null
      ? [{ ordinal: t.book_ordinal, templateStudyId: t.template_study_id }]
      : [],
  );

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/organizations"
          className="text-ui text-muted-foreground hover:text-foreground"
        >
          ← Organization
        </Link>
        <h1 className="mt-2 text-title font-bold tracking-tight">Templates</h1>
        <p className="mt-1 text-ui text-muted-foreground">
          Choose what your members start from when they create a study. Editing
          a template only affects studies created afterward.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Books</CardTitle>
          <CardDescription>
            Each book is <strong>Default</strong> (the app template),{" "}
            <strong>Override</strong> (your own), or <strong>Disabled</strong>{" "}
            (members get a plain genre starter).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrgBooksManager
            orgId={orgId}
            usesDefaults={ctx.usesDefaults}
            overrides={overrides}
            disabledOrdinals={ctx.disabledOrdinals}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custom templates</CardTitle>
          <CardDescription>
            Templates not tied to a book. The order here is the order members
            see in the create dialog.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrgCustomTemplates templates={customTemplates} genres={genres} />
        </CardContent>
      </Card>
    </div>
  );
}
