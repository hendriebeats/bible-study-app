import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createStudy } from "@/app/studies/actions";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listStudies } from "@/lib/db/studies";
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

  const studies = await listStudies();

  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Your studies</h1>
          <form action={createStudy}>
            <Button type="submit">
              <Plus className="size-4" />
              New study
            </Button>
          </form>
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
              <Link key={study.id} href={`/studies/${study.id}`}>
                <Card className="h-full transition-colors hover:border-primary/60">
                  <CardHeader>
                    <CardTitle className="truncate text-lg">
                      {study.title}
                    </CardTitle>
                    <CardDescription>
                      Updated{" "}
                      {new Date(study.updated_at).toLocaleDateString(
                        undefined,
                        {
                          dateStyle: "medium",
                        },
                      )}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
