import type { PMDocJSON } from "@/lib/editor/types";

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Study {
  id: string;
  owner_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

/** Lightweight section shape for the sidebar (no document content). */
export interface SectionSummary {
  id: string;
  study_id: string;
  title: string;
  position: number;
}

/** Full section, including its ProseMirror document. */
export interface Section extends SectionSummary {
  content: PMDocJSON;
  created_at: string;
  updated_at: string;
}

/** An empty ProseMirror document. */
export const EMPTY_DOC: PMDocJSON = { type: "doc", content: [] };
