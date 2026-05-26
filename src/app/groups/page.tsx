import { BookOpen, Users } from "lucide-react";
import Link from "next/link";

import { NewGroupForm } from "@/components/groups/new-group-form";
import { listMyGroups } from "@/lib/db/groups";

export default async function GroupsPage() {
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
        <ul className="grid gap-3">
          {groups.map((group) => (
            <li key={group.id}>
              <Link
                href={`/groups/${group.id}`}
                className="flex items-center gap-3 rounded-lg border bg-card p-4 hover:bg-accent/50"
              >
                <Users className="size-5 text-muted-foreground" />
                <span className="font-medium">{group.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
