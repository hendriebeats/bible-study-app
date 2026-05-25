import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";

import { AuthCard } from "@/components/auth/auth-shell";

export const metadata: Metadata = { title: "Check your email" };

export default function CheckEmailPage() {
  return (
    <AuthCard
      title="Check your email"
      description="We sent you a confirmation link. Open it to activate your account, then sign in."
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
