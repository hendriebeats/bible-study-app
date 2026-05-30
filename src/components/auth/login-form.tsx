"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";

import { login, type AuthState } from "@/app/(auth)/actions";
import { AuthCard, FormError, OrDivider } from "@/components/auth/auth-shell";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  // Read `?redirectTo=` here rather than as a server prop so the parent page
  // can stay synchronous (see comment in app/(auth)/login/page.tsx).
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    login,
    undefined,
  );

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to continue your study."
      footer={
        <span>
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-primary hover:underline"
          >
            Sign up
          </Link>
        </span>
      }
    >
      <OAuthButtons />
      <OrDivider />
      <form action={formAction} className="grid gap-4">
        <input
          type="hidden"
          name="redirectTo"
          value={redirectTo ?? "/dashboard"}
        />
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-ui text-muted-foreground hover:underline"
            >
              Forgot?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        {state?.error ? <FormError message={state.error} /> : null}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
