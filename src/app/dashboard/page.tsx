import type { Metadata } from "next";
import { Plus, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createStudy } from "@/app/studies/actions";
import { StudyCard } from "@/components/studies/study-card";
import { TrashButton } from "@/components/studies/trash-button";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { listStudies, listTrashedStudies } from "@/lib/db/studies";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your studies" };

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const [studies, trashedStudies] = await Promise.all([
    listStudies(),
    listTrashedStudies(),
  ]);

  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Your studies</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/groups">
                <Users className="size-4" />
                Group studies
              </Link>
            </Button>
            <TrashButton kind="study" items={trashedStudies} />
            <form action={createStudy}>
              <Button type="submit">
                <Plus className="size-4" />
                New study
              </Button>
            </form>
          </div>
        </div>

        {studies.length === 0 ? (
          <div className="mt-10 rounded-lg border border-dashed border-border/60 p-12 text-center">
            <p className="text-muted-foreground">
              You don&apos;t have any studies yet.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first one to start writing.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {studies.map((study) => (
              <StudyCard key={study.id} study={study} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
