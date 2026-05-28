// loading-exempt: brief flow / no data fetching.
import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";

import { AuthCard } from "@/components/auth/auth-shell";

export const metadata: Metadata = { title: "Reset link sent" };

export default function ResetSentPage() {
  return (
    <AuthCard
      title="Check your email"
      description="If an account exists for that address, we've sent a link to reset your password."
      footer={
        <Link
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          Back to sign in
        </Link>
      }
    >
      <div className="flex justify-center py-2 text-muted-foreground">
        <MailCheck className="size-10" />
      </div>
    </AuthCard>
  );
}
