"use client";

import { Plus, X } from "lucide-react";
import { forwardRef, useImperativeHandle, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface InviteRowDraft {
  email: string;
  role: "owner" | "member";
}

/** Drop empty rows (email-less, no point keeping them); the caller decides
 * whether an all-empty payload still counts as a submission. */
export function dropEmptyInviteRows(rows: InviteRowDraft[]): InviteRowDraft[] {
  return rows.filter((row) => row.email.trim() !== "");
}

export interface InviteRowsFormHandle {
  /** Returns the current rows (after dropping email-empty ones). */
  collect(): InviteRowDraft[];
  reset(): void;
}

/**
 * The shared multi-row invite form. Progressive disclosure: a row's role
 * select + remove ✕, and the form's "+ Add another", only appear once the
 * row has content or multiple rows exist — so the cold-start state is just
 * one bare email input. Nothing is autofocused: the parent decides when this
 * appears, and the user can drift past without being grabbed.
 *
 * The parent owns the submit button (kept in the dialog footer or section
 * footer so action buttons are placed consistently) and reads rows via the
 * imperative handle on submit. Whether empty-payload submissions are allowed
 * is also the parent's call (the "Create group" dialog allows zero invites;
 * the in-group invite section requires at least one).
 */
export const InviteRowsForm = forwardRef<
  InviteRowsFormHandle,
  {
    disabled?: boolean;
    /** Optional initial rows. Defaults to one empty row. */
    initialRows?: InviteRowDraft[];
    /** Empty-state hint shown on every empty input. */
    placeholder?: string;
  }
>(function InviteRowsForm(
  { disabled = false, initialRows, placeholder = "Email address" },
  ref,
) {
  const [rows, setRows] = useState<InviteRowDraft[]>(
    () => initialRows ?? [{ email: "", role: "member" }],
  );

  useImperativeHandle(
    ref,
    () => ({
      collect: () => dropEmptyInviteRows(rows),
      reset: () => {
        setRows([{ email: "", role: "member" }]);
      },
    }),
    [rows],
  );

  function setRow(index: number, patch: Partial<InviteRowDraft>) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    setRows((prev) => [...prev, { email: "", role: "member" }]);
  }

  function removeRow(index: number) {
    setRows((prev) => {
      if (prev.length === 1) {
        // Last row stays, just cleared — the form should always show at least
        // one editable row so the user has somewhere to type.
        return [{ email: "", role: "member" }];
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  const anyTyped = rows.some((row) => row.email.trim() !== "");
  const multiRow = rows.length > 1;

  return (
    <div className={cn("grid gap-2", disabled ? "opacity-60" : null)}>
      {rows.map((row, index) => {
        const hasContent = row.email.trim() !== "";
        // Row-level controls (role + ✕) appear once the row is in use, or
        // whenever there are siblings so the user can tell rows apart.
        const showControls = hasContent || multiRow;
        return (
          <div key={index} className="flex items-center gap-2">
            <Input
              type="email"
              value={row.email}
              onChange={(event) => {
                setRow(index, { email: event.target.value });
              }}
              placeholder={placeholder}
              aria-label={`Invite ${(index + 1).toString()} email`}
              disabled={disabled}
              className="min-w-0 flex-1"
            />
            {showControls ? (
              <>
                <select
                  aria-label={`Invite ${(index + 1).toString()} role`}
                  value={row.role}
                  disabled={disabled}
                  onChange={(event) => {
                    setRow(index, {
                      role: event.target.value as "owner" | "member",
                    });
                  }}
                  className="h-8 shrink-0 rounded-md border bg-background px-2 text-ui"
                >
                  <option value="member">Member</option>
                  <option value="owner">Owner</option>
                </select>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove invite ${(index + 1).toString()}`}
                  disabled={disabled}
                  onClick={() => {
                    removeRow(index);
                  }}
                  className="size-8 shrink-0 text-muted-foreground"
                >
                  <X className="size-4" />
                </Button>
              </>
            ) : null}
          </div>
        );
      })}
      {anyTyped ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={addRow}
          className="self-start text-muted-foreground"
        >
          <Plus className="size-4" />
          Add another
        </Button>
      ) : null}
    </div>
  );
});
