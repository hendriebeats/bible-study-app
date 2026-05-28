import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streamed for any auth route while the page resolves. Under
 * `cacheComponents: true`, client hooks like `useSearchParams()` suspend on the
 * server during the initial page load — `<LoginForm>` reads `?redirectTo=`
 * that way, so this fallback covers that brief suspend on first paint. After
 * hydration, subsequent client navigations resolve the params synchronously.
 *
 * Mirrors the auth-card shape used by every page in the route group.
 */
export default function AuthLoading() {
  return (
    <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="mt-6 grid gap-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-px w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
