import { BookOpen } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { GroupsList } from "@/components/groups/groups-list";
import { NewGroupForm } from "@/components/groups/new-group-form";
import { listMyGroups } from "@/lib/db/groups";
import { createClient } from "@/lib/supabase/server";

export default async function GroupsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  const groups = await listMyGroups();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <Link
        href="/dashboard"
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <BookOpen className="size-4" />
        All studies
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-bold">Group studies</h1>

      <div className="mb-8">
        <NewGroupForm />
      </div>

      {groups.length === 0 ? (
        <p className="text-muted-foreground">
          You’re not in any group studies yet. Create one to study alongside
          others, then invite them.
        </p>
      ) : (
        <GroupsList
          groups={groups.map((g) => ({ id: g.id, name: g.name }))}
          meId={user.id}
        />
      )}
    </div>
  );
}
