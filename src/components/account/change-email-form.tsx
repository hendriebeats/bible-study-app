"use client";

import { useActionState, useRef } from "react";

import { changeEmail, type ActionState } from "@/app/account/actions";
import { useActionFeedback } from "@/components/account/use-action-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    changeEmail,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useActionFeedback(state, formRef);

  return (
    <form ref={formRef} action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="new-email">New email</Label>
        <Input
          id="new-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={currentEmail}
          required
        />
        <p className="text-xs text-muted-foreground">
          You&apos;ll get a confirmation link at both your current and new
          address; the change applies once confirmed.
        </p>
      </div>
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Sending…" : "Change email"}
        </Button>
      </div>
    </form>
  );
}
