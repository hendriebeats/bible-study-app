"use client";

import { Building2, MapPin, Search } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { requestToJoinOrg } from "@/app/organizations/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getInitials } from "@/lib/avatar";
import type { Organization } from "@/lib/db/types";

export function OrgSearch({
  orgs,
  canJoin,
}: {
  orgs: Organization[];
  canJoin: boolean;
}) {
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") {
      return orgs;
    }
    return orgs.filter((o) =>
      [o.name, o.description, o.city, o.region, o.country]
        .filter((field): field is string => Boolean(field))
        .some((field) => field.toLowerCase().includes(q)),
    );
  }, [orgs, query]);

  function join(org: Organization) {
    startTransition(() => {
      void requestToJoinOrg(org.id, "").then((result) => {
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        if (result.status === "requested") {
          setRequestedIds((prev) => new Set(prev).add(org.id));
          toast.success("Request sent — an admin will review it.");
        } else {
          toast.success(`You've joined ${org.name}.`);
        }
      });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search organizations…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="pl-8"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 p-8 text-center text-ui text-muted-foreground">
          No organizations match your search.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((org) => {
            const place = [org.city, org.region, org.country]
              .filter(Boolean)
              .join(", ");
            const requested = requestedIds.has(org.id);
            return (
              <li
                key={org.id}
                className="flex items-start gap-4 rounded-lg border bg-card p-4"
              >
                <Avatar className="size-12 shrink-0 rounded-lg">
                  {org.icon_url ? (
                    <AvatarImage src={org.icon_url} alt={org.name} />
                  ) : null}
                  <AvatarFallback className="rounded-lg">
                    {org.name ? (
                      getInitials(org.name)
                    ) : (
                      <Building2 className="size-5" />
                    )}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{org.name}</p>
                  {place ? (
                    <p className="flex items-center gap-1 text-caption text-muted-foreground">
                      <MapPin className="size-3" />
                      {place}
                    </p>
                  ) : null}
                  <p className="mt-1 line-clamp-2 text-ui text-muted-foreground">
                    {org.description}
                  </p>
                </div>
                {canJoin ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending || requested}
                    onClick={() => {
                      join(org);
                    }}
                  >
                    {requested
                      ? "Requested"
                      : org.join_policy === "open"
                        ? "Join"
                        : "Request to join"}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
