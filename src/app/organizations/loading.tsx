import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streamed while `/organizations` resolves `getMyMembership` + the parallel
 * org/announcements/invitations fetches. Sits inside the layout's `<main>`,
 * so this fallback only fills that container — the chrome (header, max-width
 * wrapper) is already streamed.
 *
 * The skeleton renders the most likely shape (member-of-an-org): big org
 * avatar + title block, a row of action buttons, an announcements section.
 * The non-member landing has a slightly different shape but uses the same
 * outer paddings, so this still avoids the worst CLS.
 */
export default function OrganizationsLoading() {
  return (
    <div className="grid gap-8">
      <div className="flex items-start gap-4">
        <Skeleton className="size-14 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>

      <section className="grid gap-3">
        <Skeleton className="h-4 w-32" />
        <ul className="grid gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <li
              key={i}
              className="rounded-lg border border-border/60 bg-card p-3"
            >
              <Skeleton className="h-4 w-full" />
              <Skeleton className="mt-2 h-3 w-24" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
