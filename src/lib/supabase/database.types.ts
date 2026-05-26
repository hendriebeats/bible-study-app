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
      book_genres: {
        Row: {
          book_name: string
          book_ordinal: number
          genre_slug: string
        }
        Insert: {
          book_name: string
          book_ordinal: number
          genre_slug: string
        }
        Update: {
          book_name?: string
          book_ordinal?: number
          genre_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_genres_genre_slug_fkey"
            columns: ["genre_slug"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["slug"]
          },
        ]
      }
      dismissed_announcements: {
        Row: {
          announcement_id: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dismissed_announcements_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "organization_announcements"
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
          default_content: Json | null
          genre_id: string
          id: string
          lineage_id: string
          placeholder: string | null
          position: number
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_content?: Json | null
          genre_id: string
          id?: string
          lineage_id?: string
          placeholder?: string | null
          position?: number
          subtitle?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_content?: Json | null
          genre_id?: string
          id?: string
          lineage_id?: string
          placeholder?: string | null
          position?: number
          subtitle?: string | null
          title?: string
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
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          link: string | null
          organization_id: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          organization_id?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          organization_id?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_disabled_book_templates: {
        Row: {
          book_ordinal: number
          organization_id: string
        }
        Insert: {
          book_ordinal: number
          organization_id: string
        }
        Update: {
          book_ordinal?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_disabled_book_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_announcements: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          organization_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          organization_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_announcements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_by: string | null
          created_at: string
          email: string | null
          expires_at: string
          id: string
          inviter_id: string | null
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          token: string
          updated_at: string
        }
        Insert: {
          accepted_by?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          inviter_id?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token: string
          updated_at?: string
        }
        Update: {
          accepted_by?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          inviter_id?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_join_requests: {
        Row: {
          created_at: string
          id: string
          note: string | null
          organization_id: string
          reviewed_by: string | null
          status: Database["public"]["Enums"]["join_request_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          organization_id: string
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["join_request_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          organization_id?: string
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["join_request_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_join_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          id: string
          joined_at: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          city: string | null
          contact_email: string | null
          country: string | null
          created_at: string
          created_by: string | null
          description: string
          icon_url: string | null
          id: string
          join_policy: Database["public"]["Enums"]["org_join_policy"]
          name: string
          region: string | null
          updated_at: string
          use_default_template_library: boolean
          verification_note: string | null
          verification_reject_reason: string | null
          verification_reviewed_at: string | null
          verification_reviewed_by: string | null
          verification_status: Database["public"]["Enums"]["org_verification_status"]
          visibility: Database["public"]["Enums"]["org_visibility"]
          website: string | null
        }
        Insert: {
          city?: string | null
          contact_email?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          icon_url?: string | null
          id?: string
          join_policy?: Database["public"]["Enums"]["org_join_policy"]
          name: string
          region?: string | null
          updated_at?: string
          use_default_template_library?: boolean
          verification_note?: string | null
          verification_reject_reason?: string | null
          verification_reviewed_at?: string | null
          verification_reviewed_by?: string | null
          verification_status?: Database["public"]["Enums"]["org_verification_status"]
          visibility?: Database["public"]["Enums"]["org_visibility"]
          website?: string | null
        }
        Update: {
          city?: string | null
          contact_email?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          icon_url?: string | null
          id?: string
          join_policy?: Database["public"]["Enums"]["org_join_policy"]
          name?: string
          region?: string | null
          updated_at?: string
          use_default_template_library?: boolean
          verification_note?: string | null
          verification_reject_reason?: string | null
          verification_reviewed_at?: string | null
          verification_reviewed_by?: string | null
          verification_status?: Database["public"]["Enums"]["org_verification_status"]
          visibility?: Database["public"]["Enums"]["org_visibility"]
          website?: string | null
        }
        Relationships: []
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
          is_app_template: boolean
          owner_group_id: string | null
          owner_id: string | null
          owner_org_id: string | null
          source_template_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          genre_id?: string | null
          id?: string
          is_app_template?: boolean
          owner_group_id?: string | null
          owner_id?: string | null
          owner_org_id?: string | null
          source_template_id?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          genre_id?: string | null
          id?: string
          is_app_template?: boolean
          owner_group_id?: string | null
          owner_id?: string | null
          owner_org_id?: string | null
          source_template_id?: string | null
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
          {
            foreignKeyName: "studies_owner_org_id_fkey"
            columns: ["owner_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "studies_source_template_id_fkey"
            columns: ["source_template_id"]
            isOneToOne: false
            referencedRelation: "study_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      study_templates: {
        Row: {
          book_ordinal: number | null
          created_at: string
          created_by: string | null
          description: string | null
          enabled: boolean
          genre_id: string | null
          id: string
          name: string
          organization_id: string | null
          position: number
          scope: Database["public"]["Enums"]["template_scope"]
          template_study_id: string
          type: Database["public"]["Enums"]["template_type"]
          updated_at: string
        }
        Insert: {
          book_ordinal?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          genre_id?: string | null
          id?: string
          name: string
          organization_id?: string | null
          position?: number
          scope: Database["public"]["Enums"]["template_scope"]
          template_study_id: string
          type: Database["public"]["Enums"]["template_type"]
          updated_at?: string
        }
        Update: {
          book_ordinal?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          genre_id?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          position?: number
          scope?: Database["public"]["Enums"]["template_scope"]
          template_study_id?: string
          type?: Database["public"]["Enums"]["template_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_templates_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_templates_template_study_id_fkey"
            columns: ["template_study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          format_recents: Json
          scripture_options: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          format_recents?: Json
          scripture_options?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          format_recents?: Json
          scripture_options?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      accept_org_invitation: { Args: { _token: string }; Returns: string }
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
      approve_join_request: { Args: { _id: string }; Returns: undefined }
      archive_expired_trash: { Args: never; Returns: undefined }
      attach_study_to_group: {
        Args: { _group_study_id: string; _study_id?: string }
        Returns: string
      }
      can_edit_template_study: { Args: { _study_id: string }; Returns: boolean }
      can_read_document: { Args: { _document_id: string }; Returns: boolean }
      can_read_section: { Args: { _section_id: string }; Returns: boolean }
      can_read_study: { Args: { _study_id: string }; Returns: boolean }
      can_read_template_study: { Args: { _study_id: string }; Returns: boolean }
      create_app_custom_template: {
        Args: { _genre_id?: string; _name: string }
        Returns: string
      }
      create_document_checkpoint: {
        Args: { _document_id: string; _label?: string }
        Returns: string
      }
      create_group_study: { Args: { _name: string }; Returns: string }
      create_org_template: {
        Args: {
          _book_ordinal?: number
          _genre_id?: string
          _name?: string
          _type: string
        }
        Returns: string
      }
      create_organization: {
        Args: { _description: string; _name: string }
        Returns: string
      }
      create_section_checkpoint: {
        Args: { _label?: string; _section_id: string }
        Returns: string
      }
      create_study_from_selection: {
        Args: {
          _book_ordinal?: number
          _genre_id?: string
          _kind: string
          _template_id?: string
          _title: string
        }
        Returns: string
      }
      decline_invitation: { Args: { _token: string }; Returns: undefined }
      decline_org_invitation: { Args: { _token: string }; Returns: undefined }
      deny_join_request: { Args: { _id: string }; Returns: undefined }
      genre_blocks_doc: { Args: { _genre_id: string }; Returns: Json }
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
      get_org_invitation: {
        Args: { _token: string }
        Returns: {
          expires_at: string
          invite_role: Database["public"]["Enums"]["org_role"]
          organization_id: string
          organization_name: string
          status: string
        }[]
      }
      instantiate_study_from_template: {
        Args: { _template_study_id: string; _title?: string }
        Returns: string
      }
      is_admin: { Args: never; Returns: boolean }
      is_document_owner: { Args: { _document_id: string }; Returns: boolean }
      is_group_member: { Args: { _group_study_id: string }; Returns: boolean }
      is_group_owner: { Args: { _group_study_id: string }; Returns: boolean }
      is_org_admin: { Args: { _org_id: string }; Returns: boolean }
      is_org_member: { Args: { _org_id: string }; Returns: boolean }
      is_org_super_admin: { Args: { _org_id: string }; Returns: boolean }
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
      list_my_org_invitations: {
        Args: never
        Returns: {
          expires_at: string
          invite_role: Database["public"]["Enums"]["org_role"]
          organization_id: string
          organization_name: string
          token: string
        }[]
      }
      mark_notifications_read: { Args: { _ids?: string[] }; Returns: undefined }
      my_org_id: { Args: never; Returns: string }
      post_org_announcement: { Args: { _body: string }; Returns: string }
      realtime_document_id: { Args: never; Returns: string }
      realtime_section_id: { Args: never; Returns: string }
      request_to_join_org: {
        Args: { _note?: string; _org: string }
        Returns: string
      }
      review_org_verification: {
        Args: { _decision: string; _org: string; _reason?: string }
        Returns: undefined
      }
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
      shares_org_with_user: { Args: { _user_id: string }; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      submit_org_verification: { Args: { _note?: string }; Returns: undefined }
    }
    Enums: {
      document_kind: "notes" | "blocks"
      invitation_status: "pending" | "accepted" | "revoked" | "expired"
      join_request_status: "pending" | "approved" | "denied"
      org_join_policy: "request" | "open"
      org_role: "super_admin" | "admin" | "member"
      org_verification_status:
        | "unverified"
        | "pending"
        | "verified"
        | "rejected"
      org_visibility: "public" | "unlisted"
      template_scope: "app" | "org"
      template_type: "book" | "custom"
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
      join_request_status: ["pending", "approved", "denied"],
      org_join_policy: ["request", "open"],
      org_role: ["super_admin", "admin", "member"],
      org_verification_status: [
        "unverified",
        "pending",
        "verified",
        "rejected",
      ],
      org_visibility: ["public", "unlisted"],
      template_scope: ["app", "org"],
      template_type: ["book", "custom"],
    },
  },
} as const
