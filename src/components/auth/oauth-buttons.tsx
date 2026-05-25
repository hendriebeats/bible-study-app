"use client";

import { useState } from "react";

import { GoogleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { getSiteURL } from "@/lib/url";

export function OAuthButtons() {
  const [pending, setPending] = useState(false);

  async function signInWithGoogle() {
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${getSiteURL()}/auth/callback` },
    });
    // On success the browser is redirected; only reset on failure.
    if (error) {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => {
          void signInWithGoogle();
        }}
      >
        <GoogleIcon className="size-4" />
        Continue with Google
      </Button>
    </div>
  );
}
