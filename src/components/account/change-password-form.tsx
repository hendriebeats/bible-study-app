"use client";

import { useActionState, useRef } from "react";

import { changePassword, type ActionState } from "@/app/account/actions";
import { useActionFeedback } from "@/components/account/use-action-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChangePasswordForm({
  requireCurrent,
}: {
  requireCurrent: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    changePassword,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useActionFeedback(state, formRef);

  return (
    <form ref={formRef} action={formAction} className="grid gap-4">
      {requireCurrent ? (
        <div className="grid gap-2">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="new-password">
          {requireCurrent ? "New password" : "Set a password"}
        </Label>
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input
          id="confirm-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending
            ? "Updating…"
            : requireCurrent
              ? "Update password"
              : "Set password"}
        </Button>
      </div>
    </form>
  );
}
