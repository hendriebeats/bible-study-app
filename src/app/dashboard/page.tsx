import type { Metadata } from "next";
import { Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { NewStudyDialog } from "@/components/studies/new-study-dialog";
import { StudiesList } from "@/components/studies/studies-list";
import { TrashButton } from "@/components/studies/trash-button";
import { Button } from "@/components/ui/button";
import { listGenres } from "@/lib/db/genres";
import { listMyStudiesEnriched, listTrashedStudies } from "@/lib/db/studies";
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

  const [studies, genres, trashedStudies] = await Promise.all([
    listMyStudiesEnriched(),
    listGenres(),
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
            <NewStudyDialog genres={genres} />
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
          <StudiesList items={studies} genres={genres} />
        )}
      </main>
    </div>
  );
}
