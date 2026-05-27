"use client";

import { useState } from "react";

import { renameStudy } from "@/app/studies/actions";
import { Input } from "@/components/ui/input";

/**
 * The study title in the top bar. Owners click it to rename in place (saves on
 * blur or Enter; Escape cancels). Non-owners see a static label.
 *
 * Parents pass `key={title}` so an external title change (rename revalidation,
 * navigation) re-seeds the input without a sync effect.
 */
export function StudyTitleControl({
  studyId,
  title,
  canEdit,
}: {
  studyId: string;
  title: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);

  if (!canEdit) {
    return (
      <span className="min-w-0 truncate text-sm font-medium">{title}</span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(true);
        }}
        title="Rename study"
        className="min-w-0 truncate rounded-sm px-1.5 py-0.5 text-left text-sm font-medium hover:bg-muted"
      >
        {title}
      </button>
    );
  }

  function commit() {
    const next = value.trim() || "Untitled study";
    setEditing(false);
    setValue(next);
    if (next !== title) {
      void renameStudy(studyId, next);
    }
  }

  return (
    <Input
      autoFocus
      value={value}
      aria-label="Study title"
      onFocus={(event) => {
        event.currentTarget.select();
      }}
      onChange={(event) => {
        setValue(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setValue(title);
          setEditing(false);
        }
      }}
      className="h-7 w-full max-w-sm min-w-0 border-0 bg-transparent px-1.5 text-sm font-medium shadow-none focus-visible:ring-1"
    />
  );
}
