"use client";

import { useTheme } from "next-themes";

import type { PresenceMember } from "@/lib/realtime/document-channel";
import { pickReadableText } from "@/lib/theme/resolve-color";
import { styleBackgroundColor, styleColor } from "@/lib/theme/style-color";
import { isThemeId } from "@/lib/theme/themes";

/**
 * A small stack of colored avatars for the people currently on a section
 * (the writer + read-along viewers). Each person's color is stable per id;
 * the initial's text colour is picked per avatar (and per theme) for
 * contrast via {@link pickReadableText}, so a yellow avatar gets dark text
 * and a blue avatar gets light — in either light or dark mode.
 */
export function PresenceAvatars({ members }: { members: PresenceMember[] }) {
  const { resolvedTheme } = useTheme();
  const theme = isThemeId(resolvedTheme) ? resolvedTheme : "light";
  if (members.length === 0) {
    return null;
  }
  const shown = members.slice(0, 4);
  const extra = members.length - shown.length;

  return (
    <div
      className="flex items-center -space-x-2"
      role="group"
      aria-label="People here"
    >
      {shown.map((member) => (
        <span
          key={member.userId}
          title={member.isOwner ? `${member.name} (editing)` : member.name}
          aria-label={member.isOwner ? `${member.name} (editing)` : member.name}
          style={{
            ...styleBackgroundColor(member.color),
            ...styleColor(pickReadableText(member.color, theme)),
          }}
          className="flex size-6 items-center justify-center rounded-full border-2 border-card text-caption font-medium"
        >
          {member.name.charAt(0).toUpperCase()}
        </span>
      ))}
      {extra > 0 ? (
        <span className="flex size-6 items-center justify-center rounded-full border-2 border-card bg-muted text-caption font-medium text-muted-foreground">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}
