"use client";

import { useState, useTransition } from "react";

import { createGroup } from "@/app/groups/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NewGroupForm() {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const value = name.trim();
        if (value === "") {
          return;
        }
        startTransition(() => {
          void createGroup(value);
        });
      }}
    >
      <Input
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        placeholder="New group name"
        aria-label="Group name"
        className="max-w-xs"
      />
      <Button type="submit" disabled={pending}>
        Create group
      </Button>
    </form>
  );
}
