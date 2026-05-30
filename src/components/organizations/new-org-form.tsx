"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createOrganization } from "@/app/organizations/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewOrgForm() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const cleanName = name.trim();
        const cleanDesc = description.trim();
        if (cleanName === "" || cleanDesc === "") {
          toast.error("A name and description are required.");
          return;
        }
        startTransition(() => {
          void createOrganization(cleanName, cleanDesc).then((result) => {
            if (result.ok) {
              router.push(result.path);
            } else {
              toast.error(result.error);
            }
          });
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="org-name">Name</Label>
        <Input
          id="org-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          placeholder="Grace Community Church"
          maxLength={120}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="org-description">Description</Label>
        <textarea
          id="org-description"
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
          placeholder="A brief description of your organization."
          rows={3}
          maxLength={500}
          className="min-h-20 rounded-md border bg-background px-3 py-2 text-ui outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create organization"}
        </Button>
      </div>
    </form>
  );
}
