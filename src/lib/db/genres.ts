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

/** A single genre by id (for the admin editor). */
export async function getGenre(genreId: string): Promise<Genre | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("genres")
    .select("id, slug, name, description, position")
    .eq("id", genreId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** How many block templates each genre has (for the admin overview). */
export async function countTemplatesByGenre(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("genre_block_templates")
    .select("genre_id");
  if (error) {
    throw new Error(error.message);
  }
  const counts = new Map<string, number>();
  for (const row of data) {
    counts.set(row.genre_id, (counts.get(row.genre_id) ?? 0) + 1);
  }
  return counts;
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
