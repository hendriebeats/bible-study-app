import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrgReviewPanel } from "@/components/admin/org-review-panel";
import { OrgStatusBadge } from "@/components/organizations/org-status-badge";
import { getOrg } from "@/lib/db/organizations";

export const metadata: Metadata = { title: "Admin · Review organization" };

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-caption font-medium text-muted-foreground">
        {label}
      </dt>
      <dd className="text-ui">{value?.trim() ? value : "—"}</dd>
    </div>
  );
}

export default async function AdminOrgReviewPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const org = await getOrg(orgId);
  if (!org) {
    notFound();
  }

  const place = [org.city, org.region, org.country].filter(Boolean).join(", ");

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/admin/organizations"
          className="text-ui text-muted-foreground hover:text-foreground"
        >
          ← Verification queue
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-title font-bold tracking-tight">{org.name}</h1>
          <OrgStatusBadge status={org.verification_status} />
        </div>
        <p className="mt-1 text-ui text-muted-foreground">{org.description}</p>
      </div>

      <dl className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
        <Field label="Name" value={org.name} />
        <Field label="Website" value={org.website} />
        <Field label="Contact email" value={org.contact_email} />
        <Field label="Address" value={place || null} />
        <div className="sm:col-span-2">
          <Field label="Note" value={org.verification_note} />
        </div>
      </dl>

      <OrgReviewPanel orgId={org.id} />
    </div>
  );
}
