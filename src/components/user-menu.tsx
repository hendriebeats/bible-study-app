"use client";

import { Building2, Keyboard, LogOut, Settings, Shield } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { signOut } from "@/app/(auth)/actions";
import { ShortcutCheatsheetDialog } from "@/components/studies/shortcut-cheatsheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials } from "@/lib/avatar";

export function UserMenu({
  displayName,
  email,
  avatarUrl,
  isAdmin = false,
}: {
  displayName: string;
  email: string;
  avatarUrl: string | null;
  isAdmin?: boolean;
}) {
  // The keyboard-shortcuts cheatsheet used to live in the editor toolbar; it
  // moved here so the toolbar can devote its real estate to formatting tools.
  // Controlled state (not a DropdownMenu-nested DialogTrigger) so the dropdown
  // closes cleanly on select before the dialog mounts.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="Account menu"
          >
            <Avatar className="size-8">
              {avatarUrl ? (
                <AvatarImage src={avatarUrl} alt={displayName} />
              ) : null}
              <AvatarFallback>
                {getInitials(displayName || email)}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <span className="block truncate font-medium">
              {displayName || "Your account"}
            </span>
            <span className="block truncate text-caption font-normal text-muted-foreground">
              {email}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/account">
              <Settings className="size-4" />
              Account settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/organizations">
              <Building2 className="size-4" />
              Organization
            </Link>
          </DropdownMenuItem>
          {isAdmin ? (
            <DropdownMenuItem asChild>
              <Link href="/admin">
                <Shield className="size-4" />
                Admin settings
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setShortcutsOpen(true);
            }}
          >
            <Keyboard className="size-4" />
            Keyboard shortcuts
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <form action={signOut}>
            <DropdownMenuItem asChild>
              <button type="submit" className="w-full">
                <LogOut className="size-4" />
                Sign out
              </button>
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>

      <ShortcutCheatsheetDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
    </>
  );
}
