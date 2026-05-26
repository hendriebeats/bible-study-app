import type { Metadata } from "next";
import Link from "next/link";

import { OrgAcceptForm } from "@/components/organizations/org-accept-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Organization invitation" };

export default async function AcceptOrgInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  function shell(body: React.ReactNode) {
    return (
      <div className="mx-auto w-full max-w-md py-8">
        <h1 className="mb-4 text-2xl font-bold">Organization invitation</h1>
        {body}
      </div>
    );
  }

  if (!token) {
    return shell(<p className="text-muted-foreground">No invitation token.</p>);
  }

  const supabase = await createClient();
  const { data: rows } = await supabase.rpc("get_org_invitation", {
    _token: token,
  });
  const invite = rows?.[0];

  if (!invite) {
    return shell(
      <p className="text-muted-foreground">This invitation link is invalid.</p>,
    );
  }
  if (invite.status !== "pending" || new Date(invite.expires_at) < new Date()) {
    return shell(
      <div className="grid gap-3">
        <p className="text-muted-foreground">
          This invitation is no longer valid.
        </p>
        <Link href="/organizations" className="text-sm text-primary underline">
          Go to organizations
        </Link>
      </div>,
    );
  }

  return shell(
    <OrgAcceptForm
      token={token}
      organizationName={invite.organization_name}
      role={invite.invite_role}
    />,
  );
}
