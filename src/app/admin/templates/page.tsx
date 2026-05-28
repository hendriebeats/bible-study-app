import type { Metadata } from "next";
import { BookOpen, Layers } from "lucide-react";
import Link from "next/link";

import { AdminCustomTemplatesList } from "@/components/admin/admin-custom-templates-list";
import { NewAppTemplateForm } from "@/components/admin/new-app-template-form";
import { listGenres } from "@/lib/db/genres";
import {
  listAppBookTemplates,
  listAppCustomTemplates,
} from "@/lib/db/templates";
import type { StudyTemplate } from "@/lib/db/types";

export const metadata: Metadata = { title: "Admin · Templates" };

function BookList({ title, items }: { title: string; items: StudyTemplate[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {items.map((t) => (
          <li key={t.id}>
            <Link
              href={`/studies/${t.template_study_id}`}
              className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted/50"
            >
              <BookOpen className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{t.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function AdminTemplatesPage() {
  const [bookTemplates, customTemplates, genres] = await Promise.all([
    listAppBookTemplates(),
    listAppCustomTemplates(),
    listGenres(),
  ]);
  const ot = bookTemplates.filter((t) => (t.book_ordinal ?? 0) <= 39);
  const nt = bookTemplates.filter((t) => (t.book_ordinal ?? 0) >= 40);

  return (
    <div className="grid gap-8">
      <div>
        <Link
          href="/admin"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Admin
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <Layers className="size-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Study templates</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          The default library users create studies from. Open one to edit it in
          the normal editor — changes apply to future studies only.
        </p>
      </div>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Custom templates
        </h2>
        <NewAppTemplateForm genres={genres} />
        <AdminCustomTemplatesList templates={customTemplates} />
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Book templates
        </h2>
        <BookList title="Old Testament" items={ot} />
        <BookList title="New Testament" items={nt} />
      </section>
    </div>
  );
}
