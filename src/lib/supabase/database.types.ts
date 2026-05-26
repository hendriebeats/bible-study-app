export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      document_highlights: {
        Row: {
          created_at: string
          document_id: string
          id: string
          ranges: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          ranges?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          ranges?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_highlights_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          content: Json
          created_at: string
          current_version: number
          id: string
          kind: Database["public"]["Enums"]["document_kind"]
          section_id: string
          updated_at: string
        }
        Insert: {
          content?: Json
          created_at?: string
          current_version?: number
          id?: string
          kind: Database["public"]["Enums"]["document_kind"]
          section_id: string
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          current_version?: number
          id?: string
          kind?: Database["public"]["Enums"]["document_kind"]
          section_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      genre_block_templates: {
        Row: {
          created_at: string
          genre_id: string
          id: string
          label: string
          lineage_id: string
          position: number
          prompt: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          genre_id: string
          id?: string
          label: string
          lineage_id?: string
          position?: number
          prompt?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          genre_id?: string
          id?: string
          label?: string
          lineage_id?: string
          position?: number
          prompt?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "genre_block_templates_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
        ]
      }
      genres: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          position: number
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          position?: number
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          position?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      group_studies: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          template_study_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          template_study_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          template_study_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_studies_template_study_id_fkey"
            columns: ["template_study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      group_study_members: {
        Row: {
          group_study_id: string
          id: string
          joined_at: string
          role: string
          study_id: string | null
          user_id: string
        }
        Insert: {
          group_study_id: string
          id?: string
          joined_at?: string
          role?: string
          study_id?: string | null
          user_id: string
        }
        Update: {
          group_study_id?: string
          id?: string
          joined_at?: string
          role?: string
          study_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_study_members_group_study_id_fkey"
            columns: ["group_study_id"]
            isOneToOne: false
            referencedRelation: "group_studies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_study_members_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_by: string | null
          created_at: string
          email: string | null
          expires_at: string
          group_study_id: string
          id: string
          inviter_id: string | null
          role: string
          status: Database["public"]["Enums"]["invitation_status"]
          token: string
          updated_at: string
        }
        Insert: {
          accepted_by?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string
          group_study_id: string
          id?: string
          inviter_id?: string | null
          role?: string
          status?: Database["public"]["Enums"]["invitation_status"]
          token: string
          updated_at?: string
        }
        Update: {
          accepted_by?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string
          group_study_id?: string
          id?: string
          inviter_id?: string | null
          role?: string
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_group_study_id_fkey"
            columns: ["group_study_id"]
            isOneToOne: false
            referencedRelation: "group_studies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          is_admin: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          is_admin?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_admin?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      scripture_passages: {
        Row: {
          book: string
          book_ordinal: number
          created_at: string
          end_chapter: number
          end_verse: number
          end_verse_id: number
          id: string
          position: number
          reference: string
          section_id: string
          start_chapter: number
          start_verse: number
          start_verse_id: number
          updated_at: string
          version: string
        }
        Insert: {
          book: string
          book_ordinal: number
          created_at?: string
          end_chapter: number
          end_verse: number
          end_verse_id: number
          id?: string
          position?: number
          reference: string
          section_id: string
          start_chapter: number
          start_verse: number
          start_verse_id: number
          updated_at?: string
          version?: string
        }
        Update: {
          book?: string
          book_ordinal?: number
          created_at?: string
          end_chapter?: number
          end_verse?: number
          end_verse_id?: number
          id?: string
          position?: number
          reference?: string
          section_id?: string
          start_chapter?: number
          start_verse?: number
          start_verse_id?: number
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "scripture_passages_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      section_alignments: {
        Row: {
          is_manual: boolean
          my_section_id: string
          scroll_top: number
          target_section_id: string | null
          target_study_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          is_manual?: boolean
          my_section_id: string
          scroll_top?: number
          target_section_id?: string | null
          target_study_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          is_manual?: boolean
          my_section_id?: string
          scroll_top?: number
          target_section_id?: string | null
          target_study_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "section_alignments_my_section_id_fkey"
            columns: ["my_section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_alignments_target_section_id_fkey"
            columns: ["target_section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_alignments_target_study_id_fkey"
            columns: ["target_study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      section_checkpoints: {
        Row: {
          created_at: string
          created_by: string | null
          doc: Json
          document_id: string | null
          id: string
          label: string | null
          section_id: string | null
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          doc: Json
          document_id?: string | null
          id?: string
          label?: string | null
          section_id?: string | null
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          doc?: Json
          document_id?: string | null
          id?: string
          label?: string | null
          section_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "section_checkpoints_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_checkpoints_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      section_steps: {
        Row: {
          client_id: string | null
          created_at: string
          document_id: string | null
          id: number
          section_id: string | null
          step: Json
          version: number
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          document_id?: string | null
          id?: never
          section_id?: string | null
          step: Json
          version: number
        }
        Update: {
          client_id?: string | null
          created_at?: string
          document_id?: string | null
          id?: never
          section_id?: string | null
          step?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "section_steps_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_steps_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          archived_at: string | null
          content: Json
          created_at: string
          current_version: number
          deleted_at: string | null
          id: string
          lineage_id: string
          position: number
          study_id: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          content?: Json
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          id?: string
          lineage_id?: string
          position?: number
          study_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          content?: Json
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          id?: string
          lineage_id?: string
          position?: number
          study_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sections_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      studies: {
        Row: {
          archived_at: string | null
          created_at: string
          deleted_at: string | null
          genre_id: string | null
          id: string
          owner_group_id: string | null
          owner_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          genre_id?: string | null
          id?: string
          owner_group_id?: string | null
          owner_id?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          genre_id?: string | null
          id?: string
          owner_group_id?: string | null
          owner_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "studies_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "studies_owner_group_id_fkey"
            columns: ["owner_group_id"]
            isOneToOne: false
            referencedRelation: "group_studies"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_states: {
        Row: {
          layout: Json
          layout_version: number
          study_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          layout: Json
          layout_version?: number
          study_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          layout?: Json
          layout_version?: number
          study_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_states_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: {
        Args: { _study_id?: string; _token: string }
        Returns: string
      }
      align_sections: {
        Args: { _my_section_id: string; _target_study_id: string }
        Returns: {
          lineage_match: boolean
          overlap: number
          score: number
          section_id: string
          section_position: number
          title: string
        }[]
      }
      append_document_steps: {
        Args: {
          _client_id?: string
          _document_id: string
          _expected_base: number
          _new_doc: Json
          _steps: Json
        }
        Returns: number
      }
      append_section_steps: {
        Args: {
          _client_id?: string
          _expected_base: number
          _new_doc: Json
          _section_id: string
          _steps: Json
        }
        Returns: number
      }
      archive_expired_trash: { Args: never; Returns: undefined }
      attach_study_to_group: {
        Args: { _group_study_id: string; _study_id?: string }
        Returns: string
      }
      can_read_document: { Args: { _document_id: string }; Returns: boolean }
      can_read_section: { Args: { _section_id: string }; Returns: boolean }
      can_read_study: { Args: { _study_id: string }; Returns: boolean }
      create_document_checkpoint: {
        Args: { _document_id: string; _label?: string }
        Returns: string
      }
      create_group_study: { Args: { _name: string }; Returns: string }
      create_section_checkpoint: {
        Args: { _label?: string; _section_id: string }
        Returns: string
      }
      decline_invitation: { Args: { _token: string }; Returns: undefined }
      get_invitation: {
        Args: { _token: string }
        Returns: {
          expires_at: string
          group_name: string
          group_study_id: string
          invite_role: string
          status: string
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      is_document_owner: { Args: { _document_id: string }; Returns: boolean }
      is_group_member: { Args: { _group_study_id: string }; Returns: boolean }
      is_group_owner: { Args: { _group_study_id: string }; Returns: boolean }
      is_section_owner: { Args: { _section_id: string }; Returns: boolean }
      is_study_owner: { Args: { _study_id: string }; Returns: boolean }
      list_my_invitations: {
        Args: never
        Returns: {
          expires_at: string
          group_name: string
          group_study_id: string
          invite_role: string
          token: string
        }[]
      }
      realtime_document_id: { Args: never; Returns: string }
      realtime_section_id: { Args: never; Returns: string }
      seed_my_group_study: {
        Args: { _group_study_id: string }
        Returns: string
      }
      seed_study_from_template: {
        Args: { _group_study_id: string }
        Returns: string
      }
      shares_group_with_study: { Args: { _study_id: string }; Returns: boolean }
      shares_group_with_user: { Args: { _user_id: string }; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      document_kind: "notes" | "blocks"
      invitation_status: "pending" | "accepted" | "revoked" | "expired"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      document_kind: ["notes", "blocks"],
      invitation_status: ["pending", "accepted", "revoked", "expired"],
    },
  },
} as const
