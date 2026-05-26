"use client";

import type { PresenceMember } from "@/lib/realtime/document-channel";

/**
 * A small stack of colored avatars for the people currently on a section
 * (the writer + read-along viewers). Each person's color is stable per id.
 */
export function PresenceAvatars({ members }: { members: PresenceMember[] }) {
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
          style={{ backgroundColor: member.color }}
          className="flex size-6 items-center justify-center rounded-full border-2 border-card text-xs font-medium text-white"
        >
          {member.name.charAt(0).toUpperCase()}
        </span>
      ))}
      {extra > 0 ? (
        <span className="flex size-6 items-center justify-center rounded-full border-2 border-card bg-muted text-xs font-medium text-muted-foreground">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}
