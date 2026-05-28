"use client";

import Link from "next/link";
import { useState } from "react";

import { DeleteTemplateButton } from "@/components/templates/delete-template-button";
import { TemplateMetaEditor } from "@/components/templates/template-meta-editor";
import type { StudyTemplate } from "@/lib/db/types";

/**
 * Client wrapper around the admin's custom-template list so edits and deletes
 * can update the rendered list in place without an RSC refetch (the blank-then-
 * fill flicker `router.refresh()` used to cause). Server-side `revalidatePath`
 * inside the actions still keeps next navigation fresh — this just removes the
 * visible round-trip on the current page.
 *
 * The render-time prop-sync pattern (compare `prevTemplates`, reset `items`
 * when the prop changes) lets a fresh server render — e.g. when a new template
 * is created via NewAppTemplateForm + navigation — replace local state cleanly.
 */
export function AdminCustomTemplatesList({
  templates,
}: {
  templates: StudyTemplate[];
}) {
  const [items, setItems] = useState(templates);
  const [prevTemplates, setPrevTemplates] = useState(templates);
  if (templates !== prevTemplates) {
    setPrevTemplates(templates);
    setItems(templates);
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No custom templates yet.</p>
    );
  }

  return (
    <ul className="grid gap-2">
      {items.map((t) => (
        <li key={t.id} className="grid gap-2 rounded-md border p-3">
          <TemplateMetaEditor
            templateId={t.id}
            templateStudyId={t.template_study_id}
            name={t.name}
            description={t.description}
            scope="app"
            onSaved={(patch) => {
              setItems((current) =>
                current.map((row) =>
                  row.id === t.id
                    ? {
                        ...row,
                        name: patch.name,
                        description:
                          patch.description === "" ? null : patch.description,
                      }
                    : row,
                ),
              );
            }}
          />
          <div className="flex items-center gap-3 text-sm">
            <Link
              href={`/studies/${t.template_study_id}`}
              className="text-primary hover:underline"
            >
              Open in editor
            </Link>
            <span className="ml-auto">
              <DeleteTemplateButton
                templateStudyId={t.template_study_id}
                scope="app"
                onDeleted={() => {
                  setItems((current) =>
                    current.filter((row) => row.id !== t.id),
                  );
                }}
              />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
