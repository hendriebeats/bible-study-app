import Link from "next/link";
import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";

import { siteConfig } from "@/lib/site";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <Link
        href="/"
        className="mb-8 flex items-center gap-2 text-subheading font-semibold"
      >
        <BookOpen className="size-6 text-primary" />
        <span>{siteConfig.name}</span>
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
