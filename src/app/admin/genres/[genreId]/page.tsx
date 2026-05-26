import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BlockTemplateEditor } from "@/components/admin/block-template-editor";
import { GenreMetaForm } from "@/components/admin/genre-meta-form";
import { getGenre, getGenreBlockTemplates } from "@/lib/db/genres";

export const metadata: Metadata = { title: "Admin · Edit genre" };

export default async function AdminGenrePage({
  params,
}: {
  params: Promise<{ genreId: string }>;
}) {
  const { genreId } = await params;
  const genre = await getGenre(genreId);
  if (!genre) {
    notFound();
  }
  const templates = await getGenreBlockTemplates(genreId);

  return (
    <div>
      <Link
        href="/admin"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        All genres
      </Link>

      <div className="mt-4">
        <GenreMetaForm genre={genre} />
      </div>

      <section className="mt-8">
        <h2 className="mb-1 text-sm font-semibold text-muted-foreground">
          Default study blocks
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          New sections in a {genre.name} study start with these blocks.
        </p>
        <BlockTemplateEditor genreId={genreId} templates={templates} />
      </section>
    </div>
  );
}
