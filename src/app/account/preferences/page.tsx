import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CustomColorsPreview } from "@/components/account/custom-colors-preview";
import { EditorToolsSettings } from "@/components/account/editor-tools-settings";
import { ThemePicker } from "@/components/account/theme-picker";
import { getEditorTools, getFormatRecents } from "@/lib/db/user-settings";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account · Preferences" };

export default async function AccountPreferencesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const [editorTools, formatRecents] = await Promise.all([
    getEditorTools(),
    getFormatRecents(),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-10 pb-16">
      <h1 className="text-title font-bold tracking-tight">Preferences</h1>
      <p className="mt-1 text-ui text-muted-foreground">
        How the app looks and which editor tools you see.
      </p>

      <div className="mt-8 space-y-10">
        <section className="space-y-4">
          <h2 className="text-subheading font-semibold">Appearance</h2>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-0.5">
              <span className="text-ui font-medium">Theme</span>
              <span className="text-ui text-muted-foreground">
                Match your system, or force light or dark mode.
              </span>
            </div>
            <ThemePicker />
          </div>
        </section>

        <section className="space-y-4 border-t border-border/60 pt-8">
          <div>
            <h2 className="text-subheading font-semibold">Editor tools</h2>
            <p className="text-ui text-muted-foreground">
              Turn optional tools on or off. They appear in the study editor as
              you enable them.
            </p>
          </div>
          <EditorToolsSettings initial={editorTools} />
        </section>

        {editorTools.customColor ? (
          <CustomColorsPreview
            initialHighlights={formatRecents.customHighlights}
            initialTextColors={formatRecents.customTextColors}
          />
        ) : null}
      </div>
    </div>
  );
}
