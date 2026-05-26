"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { PMNodeJSON } from "@/lib/editor/types";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Gate every admin mutation on the server, independent of RLS. RLS already
 * blocks non-admin writes, but re-checking `is_admin()` here means the action
 * never silently no-ops for a non-admin and keeps the trust boundary explicit.
 */
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) {
    redirect("/dashboard");
  }
  return { supabase };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "genre"
  );
}

/** Create a genre and open its editor. Slug derives from the name (uniquified). */
export async function createGenre(name: string): Promise<void> {
  const { supabase } = await requireAdmin();
  const clean = name.trim();
  if (clean === "") {
    return;
  }
  const base = slugify(clean);

  const { data: maxRow } = await supabase
    .from("genres")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (maxRow?.position ?? -1) + 1;

  // Retry the slug on a unique-violation (23505) so two "Gospel"s can coexist.
  let newId: string | undefined;
  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${(attempt + 1).toString()}`;
    const { data, error } = await supabase
      .from("genres")
      .insert({ name: clean, slug, position })
      .select("id")
      .single();
    if (!error) {
      newId = data.id;
      break;
    }
    if (error.code !== "23505") {
      throw new Error(error.message);
    }
  }
  if (newId === undefined) {
    throw new Error("Couldn't create that genre — try a different name.");
  }

  revalidatePath("/admin");
  redirect(`/admin/genres/${newId}`);
}

/** Rename / re-describe a genre. */
export async function updateGenre(
  genreId: string,
  name: string,
  description: string,
): Promise<void> {
  const { supabase } = await requireAdmin();
  const cleanName = name.trim() || "Untitled genre";
  const cleanDescription = description.trim();
  const { error } = await supabase
    .from("genres")
    .update({
      name: cleanName,
      description: cleanDescription === "" ? null : cleanDescription,
    })
    .eq("id", genreId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/admin/genres/${genreId}`);
  revalidatePath("/admin");
}

/** Delete a genre. Fails (friendly) if any study still uses it. */
export async function deleteGenre(genreId: string): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("genres").delete().eq("id", genreId);
  if (error) {
    // FK from studies.genre_id (no cascade) → can't delete a genre in use.
    if (error.code === "23503") {
      return {
        ok: false,
        error: "Some studies still use this genre, so it can't be deleted.",
      };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath("/admin");
  redirect("/admin");
}

/** Append a new (blank) block template to a genre. */
export async function addBlockTemplate(genreId: string): Promise<void> {
  const { supabase } = await requireAdmin();
  const { data: maxRow } = await supabase
    .from("genre_block_templates")
    .select("position")
    .eq("genre_id", genreId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (maxRow?.position ?? -1) + 1;
  const { error } = await supabase
    .from("genre_block_templates")
    .insert({ genre_id: genreId, title: "New block", position });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/admin/genres/${genreId}`);
}

/** Edit one block template's title / subtitle / placeholder / default content. */
export async function updateBlockTemplate(
  templateId: string,
  genreId: string,
  title: string,
  subtitle: string,
  placeholder: string,
  defaultContent: PMNodeJSON[] | null,
): Promise<void> {
  const { supabase } = await requireAdmin();
  const cleanSubtitle = subtitle.trim();
  const cleanPlaceholder = placeholder.trim();
  const hasDefault = defaultContent !== null && defaultContent.length > 0;
  const { error } = await supabase
    .from("genre_block_templates")
    .update({
      title: title.trim() || "Untitled block",
      subtitle: cleanSubtitle === "" ? null : cleanSubtitle,
      placeholder: cleanPlaceholder === "" ? null : cleanPlaceholder,
      default_content: hasDefault ? (defaultContent as unknown as Json) : null,
    })
    .eq("id", templateId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/admin/genres/${genreId}`);
}

export async function deleteBlockTemplate(
  templateId: string,
  genreId: string,
): Promise<void> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("genre_block_templates")
    .delete()
    .eq("id", templateId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/admin/genres/${genreId}`);
}

/** Swap a block template with its neighbour to reorder the default set. */
export async function moveBlockTemplate(
  templateId: string,
  genreId: string,
  direction: "up" | "down",
): Promise<void> {
  const { supabase } = await requireAdmin();
  const { data: rows, error } = await supabase
    .from("genre_block_templates")
    .select("id, position")
    .eq("genre_id", genreId)
    .order("position", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  const index = rows.findIndex((r) => r.id === templateId);
  const neighbour = direction === "up" ? index - 1 : index + 1;
  const a = rows[index];
  const b = rows[neighbour];
  if (!a || !b) {
    return;
  }
  // Swap their positions (two independent updates — positions need not be gapless).
  const { error: e1 } = await supabase
    .from("genre_block_templates")
    .update({ position: b.position })
    .eq("id", a.id);
  const { error: e2 } = await supabase
    .from("genre_block_templates")
    .update({ position: a.position })
    .eq("id", b.id);
  if (e1 ?? e2) {
    throw new Error((e1 ?? e2)?.message ?? "Couldn't reorder blocks.");
  }
  revalidatePath(`/admin/genres/${genreId}`);
}
