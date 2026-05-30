import Link from "next/link";

import { AcceptForm } from "@/components/groups/accept-form";
import { listMyOwnedStudies } from "@/lib/db/groups";
import { createClient } from "@/lib/supabase/server";

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  function shell(body: React.ReactNode) {
    return (
      <div className="mx-auto w-full max-w-md px-6 py-12">
        <h1 className="mb-4 text-title font-bold">Group invitation</h1>
        {body}
      </div>
    );
  }

  if (!token) {
    return shell(<p className="text-muted-foreground">No invitation token.</p>);
  }

  const supabase = await createClient();
  const { data: rows } = await supabase.rpc("get_invitation", {
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
        <Link href="/groups" className="text-ui text-primary underline">
          Go to your groups
        </Link>
      </div>,
    );
  }

  const studies = await listMyOwnedStudies();

  return shell(
    <AcceptForm
      token={token}
      groupName={invite.group_name}
      studies={studies}
    />,
  );
}
