import type { Genre, GenreBlockTemplate } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

/** All genres, ordered for display (world-readable to authenticated users). */
export async function listGenres(): Promise<Genre[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("genres")
    .select("id, slug, name, description, position")
    .order("position", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** A genre's default block template, ordered. */
export async function getGenreBlockTemplates(
  genreId: string,
): Promise<GenreBlockTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("genre_block_templates")
    .select("id, genre_id, label, prompt, position, lineage_id")
    .eq("genre_id", genreId)
    .order("position", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}
