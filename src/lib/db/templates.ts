import { getMyMembership } from "@/lib/db/organizations";
import type { StudyTemplate } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

const TEMPLATE_COLS =
  "id, scope, organization_id, type, book_ordinal, genre_id, name, description, template_study_id, enabled, position";

/** Custom templates the caller can create from (app customs + their org customs). */
export async function listAvailableCustomTemplates(): Promise<StudyTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_templates")
    .select(TEMPLATE_COLS)
    .eq("type", "custom")
    .eq("enabled", true)
    .order("name", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** App default book templates (super-admin maintained), ordered by book. */
export async function listAppBookTemplates(): Promise<StudyTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_templates")
    .select(TEMPLATE_COLS)
    .eq("scope", "app")
    .eq("type", "book")
    .order("position", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** App custom templates (super-admin maintained). */
export async function listAppCustomTemplates(): Promise<StudyTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_templates")
    .select(TEMPLATE_COLS)
    .eq("scope", "app")
    .eq("type", "custom")
    .order("name", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** All templates an org owns (custom + book overrides). */
export async function listOrgTemplates(
  orgId: string,
): Promise<StudyTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_templates")
    .select(TEMPLATE_COLS)
    .eq("organization_id", orgId)
    .order("type", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

/** Which books an org has disabled/overridden, and whether it uses defaults. */
export interface OrgBookContext {
  inOrg: boolean;
  usesDefaults: boolean;
  disabledOrdinals: number[];
  overriddenOrdinals: number[];
}

export async function getOrgBookContext(): Promise<OrgBookContext> {
  const empty: OrgBookContext = {
    inOrg: false,
    usesDefaults: true,
    disabledOrdinals: [],
    overriddenOrdinals: [],
  };
  const membership = await getMyMembership();
  if (!membership) {
    return empty;
  }
  const orgId = membership.organizationId;
  const supabase = await createClient();
  const [{ data: org }, { data: disabled }, { data: overrides }] =
    await Promise.all([
      supabase
        .from("organizations")
        .select("use_default_template_library")
        .eq("id", orgId)
        .maybeSingle(),
      supabase
        .from("org_disabled_book_templates")
        .select("book_ordinal")
        .eq("organization_id", orgId),
      supabase
        .from("study_templates")
        .select("book_ordinal")
        .eq("organization_id", orgId)
        .eq("type", "book"),
    ]);

  return {
    inOrg: true,
    usesDefaults: org?.use_default_template_library ?? true,
    disabledOrdinals: (disabled ?? []).map((d) => d.book_ordinal),
    overriddenOrdinals: (overrides ?? [])
      .map((o) => o.book_ordinal)
      .filter((n): n is number => n !== null),
  };
}
