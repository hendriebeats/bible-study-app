import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * `?redirectTo=` is read client-side via `useSearchParams()` inside
 * `<LoginForm>` rather than awaited here. Under `cacheComponents: true`,
 * awaiting `searchParams` server-side counts as uncached request data and
 * must be wrapped in `<Suspense>`; pushing the read into the (already
 * client) form is the cleaner option for a route that does no other work.
 */
export default function LoginPage() {
  return <LoginForm />;
}
