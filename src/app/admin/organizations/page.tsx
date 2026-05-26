import type { Metadata } from "next";
import { Building2, ChevronRight } from "lucide-react";
import Link from "next/link";

import { listPendingVerifications } from "@/lib/db/organizations";

export const metadata: Metadata = { title: "Admin · Organizations" };

export default async function AdminOrgsPage() {
  const pending = await listPendingVerifications();

  return (
    <div>
      <Link
        href="/admin"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Admin
      </Link>
      <div className="mt-2 flex items-center gap-2">
        <Building2 className="size-5 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">
          Organization verification
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Organizations awaiting review before they can be listed publicly.
      </p>

      {pending.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          No organizations are awaiting review.
        </p>
      ) : (
        <ul className="mt-6 divide-y rounded-lg border">
          {pending.map((org) => {
            const place = [org.city, org.region, org.country]
              .filter(Boolean)
              .join(", ");
            return (
              <li key={org.id}>
                <Link
                  href={`/admin/organizations/${org.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{org.name}</p>
                    {place ? (
                      <p className="truncate text-sm text-muted-foreground">
                        {place}
                      </p>
                    ) : null}
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
