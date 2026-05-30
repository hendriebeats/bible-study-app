"use client";

import { useState, useTransition } from "react";

import { deleteAccount } from "@/app/account/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DangerZone({ email }: { email: string }) {
  const [confirmValue, setConfirmValue] = useState("");
  const [pending, startTransition] = useTransition();
  const canDelete = confirmValue.trim().toLowerCase() === email.toLowerCase();

  return (
    <AlertDialog
      onOpenChange={() => {
        setConfirmValue("");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={pending}>
          {pending ? "Deleting…" : "Delete account"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes your account, along with all of your
            studies and sections. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="confirm-email">
            Type <span className="font-medium">{email}</span> to confirm
          </Label>
          <Input
            id="confirm-email"
            value={confirmValue}
            autoComplete="off"
            onChange={(event) => {
              setConfirmValue(event.target.value);
            }}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(event) => {
              if (!canDelete) {
                event.preventDefault();
                return;
              }
              startTransition(() => {
                void deleteAccount();
              });
            }}
          >
            Delete account
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
