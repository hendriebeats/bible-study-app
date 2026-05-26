import { BadgeCheck, Clock, ShieldAlert, ShieldX } from "lucide-react";

import { cn } from "@/lib/utils";
import type { OrgVerificationStatus } from "@/lib/db/types";

const CONFIG: Record<
  OrgVerificationStatus,
  { label: string; icon: typeof BadgeCheck; className: string }
> = {
  verified: {
    label: "Verified",
    icon: BadgeCheck,
    className: "bg-primary/10 text-primary",
  },
  pending: {
    label: "Verification pending",
    icon: Clock,
    className: "bg-muted text-muted-foreground",
  },
  rejected: {
    label: "Verification rejected",
    icon: ShieldX,
    className: "bg-destructive/10 text-destructive",
  },
  unverified: {
    label: "Unverified",
    icon: ShieldAlert,
    className: "bg-muted text-muted-foreground",
  },
};

export function OrgStatusBadge({
  status,
  className,
}: {
  status: OrgVerificationStatus;
  className?: string;
}) {
  const { label, icon: Icon, className: tone } = CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tone,
        className,
      )}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}
