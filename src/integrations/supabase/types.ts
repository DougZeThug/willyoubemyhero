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
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          entity_id: string | null
          entity_type: string | null
          event_id: string | null
          id: string
          new_value: Json | null
          performed_at: string
          performed_by: string | null
          previous_value: Json | null
        }
        Insert: {
          action: string
          entity_id?: string | null
          entity_type?: string | null
          event_id?: string | null
          id?: string
          new_value?: Json | null
          performed_at?: string
          performed_by?: string | null
          previous_value?: Json | null
        }
        Update: {
          action?: string
          entity_id?: string | null
          entity_type?: string | null
          event_id?: string | null
          id?: string
          new_value?: Json | null
          performed_at?: string
          performed_by?: string | null
          previous_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
        ]
      }
      award_votes: {
        Row: {
          category: string
          created_at: string
          event_id: string
          id: string
          target_participant_id: string
          updated_at: string
          voter_participant_id: string
        }
        Insert: {
          category: string
          created_at?: string
          event_id: string
          id?: string
          target_participant_id: string
          updated_at?: string
          voter_participant_id: string
        }
        Update: {
          category?: string
          created_at?: string
          event_id?: string
          id?: string
          target_participant_id?: string
          updated_at?: string
          voter_participant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "award_votes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "award_votes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "award_votes_target_participant_id_fkey"
            columns: ["target_participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "award_votes_voter_participant_id_fkey"
            columns: ["voter_participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      awards: {
        Row: {
          award_name: string
          award_type: string | null
          created_at: string
          description: string | null
          event_id: string
          id: string
          participant_id: string | null
        }
        Insert: {
          award_name: string
          award_type?: string | null
          created_at?: string
          description?: string | null
          event_id: string
          id?: string
          participant_id?: string | null
        }
        Update: {
          award_name?: string
          award_type?: string | null
          created_at?: string
          description?: string | null
          event_id?: string
          id?: string
          participant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "awards_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "awards_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "awards_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      card_comments: {
        Row: {
          body: string
          created_at: string
          event_participant_id: string
          guest_key: string | null
          guest_name: string | null
          id: string
          participant_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          event_participant_id: string
          guest_key?: string | null
          guest_name?: string | null
          id?: string
          participant_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          event_participant_id?: string
          guest_key?: string | null
          guest_name?: string | null
          id?: string
          participant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "card_comments_event_participant_id_fkey"
            columns: ["event_participant_id"]
            isOneToOne: false
            referencedRelation: "event_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_comments_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      card_copies: {
        Row: {
          acquired_on: string | null
          created_at: string
          edition: string
          event_participant_id: string
          id: string
          participant_id: string
          source: string
        }
        Insert: {
          acquired_on?: string | null
          created_at?: string
          edition?: string
          event_participant_id: string
          id?: string
          participant_id: string
          source?: string
        }
        Update: {
          acquired_on?: string | null
          created_at?: string
          edition?: string
          event_participant_id?: string
          id?: string
          participant_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_copies_event_participant_id_fkey"
            columns: ["event_participant_id"]
            isOneToOne: false
            referencedRelation: "event_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_copies_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      card_prompt_runs: {
        Row: {
          created_at: string
          event_id: string | null
          event_participant_id: string | null
          generated_prompt: string
          id: string
          input_snapshot: Json
          kind: string
          parent_prompt_id: string | null
          revision_instruction: string | null
          subject_name: string
          template_id: string | null
          template_name_snapshot: string
          template_slug: string
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          event_participant_id?: string | null
          generated_prompt: string
          id?: string
          input_snapshot?: Json
          kind: string
          parent_prompt_id?: string | null
          revision_instruction?: string | null
          subject_name: string
          template_id?: string | null
          template_name_snapshot: string
          template_slug: string
        }
        Update: {
          created_at?: string
          event_id?: string | null
          event_participant_id?: string | null
          generated_prompt?: string
          id?: string
          input_snapshot?: Json
          kind?: string
          parent_prompt_id?: string | null
          revision_instruction?: string | null
          subject_name?: string
          template_id?: string | null
          template_name_snapshot?: string
          template_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_prompt_runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_prompt_runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_prompt_runs_event_participant_id_fkey"
            columns: ["event_participant_id"]
            isOneToOne: false
            referencedRelation: "event_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_prompt_runs_parent_prompt_id_fkey"
            columns: ["parent_prompt_id"]
            isOneToOne: false
            referencedRelation: "card_prompt_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_prompt_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "card_prompt_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      card_prompt_templates: {
        Row: {
          active: boolean
          created_at: string
          id: string
          master_prompt: string
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          master_prompt: string
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          master_prompt?: string
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      card_pulls: {
        Row: {
          edition: string
          event_participant_id: string
          first_pulled_at: string
          last_pulled_at: string
          participant_id: string
          pull_count: number
        }
        Insert: {
          edition?: string
          event_participant_id: string
          first_pulled_at?: string
          last_pulled_at?: string
          participant_id: string
          pull_count?: number
        }
        Update: {
          edition?: string
          event_participant_id?: string
          first_pulled_at?: string
          last_pulled_at?: string
          participant_id?: string
          pull_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "card_pulls_event_participant_id_fkey"
            columns: ["event_participant_id"]
            isOneToOne: false
            referencedRelation: "event_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_pulls_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      card_reactions: {
        Row: {
          created_at: string
          emoji: string
          event_participant_id: string
          guest_key: string | null
          guest_name: string | null
          id: string
          participant_id: string | null
        }
        Insert: {
          created_at?: string
          emoji: string
          event_participant_id: string
          guest_key?: string | null
          guest_name?: string | null
          id?: string
          participant_id?: string | null
        }
        Update: {
          created_at?: string
          emoji?: string
          event_participant_id?: string
          guest_key?: string | null
          guest_name?: string | null
          id?: string
          participant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "card_reactions_event_participant_id_fkey"
            columns: ["event_participant_id"]
            isOneToOne: false
            referencedRelation: "event_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_reactions_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_selections: {
        Row: {
          created_by: string | null
          draft_position: number
          event_id: string
          id: string
          participant_id: string
          selected_at: string
          selection_order: number
        }
        Insert: {
          created_by?: string | null
          draft_position: number
          event_id: string
          id?: string
          participant_id: string
          selected_at?: string
          selection_order: number
        }
        Update: {
          created_by?: string | null
          draft_position?: number
          event_id?: string
          id?: string
          participant_id?: string
          selected_at?: string
          selection_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "draft_selections_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_selections_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_selections_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_archive_snapshots: {
        Row: {
          created_at: string
          event_id: string
          event_name: string
          event_year: number | null
          id: string
          slug: string
          snapshot: Json
        }
        Insert: {
          created_at?: string
          event_id: string
          event_name: string
          event_year?: number | null
          id?: string
          slug: string
          snapshot: Json
        }
        Update: {
          created_at?: string
          event_id?: string
          event_name?: string
          event_year?: number | null
          id?: string
          slug?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "event_archive_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_archive_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
        ]
      }
      event_participants: {
        Row: {
          bib_number: number | null
          card_back_path: string | null
          card_back_path_medium: string | null
          card_back_path_thumb: string | null
          card_path: string | null
          card_path_medium: string | null
          card_path_thumb: string | null
          created_at: string
          draft_choice_priority: number | null
          event_id: string
          id: string
          participant_id: string
          participation_status: string
          photo_path: string | null
          photo_path_medium: string | null
          photo_path_thumb: string | null
          running_order: number
          selected_draft_position: number | null
          updated_at: string
        }
        Insert: {
          bib_number?: number | null
          card_back_path?: string | null
          card_back_path_medium?: string | null
          card_back_path_thumb?: string | null
          card_path?: string | null
          card_path_medium?: string | null
          card_path_thumb?: string | null
          created_at?: string
          draft_choice_priority?: number | null
          event_id: string
          id?: string
          participant_id: string
          participation_status?: string
          photo_path?: string | null
          photo_path_medium?: string | null
          photo_path_thumb?: string | null
          running_order?: number
          selected_draft_position?: number | null
          updated_at?: string
        }
        Update: {
          bib_number?: number | null
          card_back_path?: string | null
          card_back_path_medium?: string | null
          card_back_path_thumb?: string | null
          card_path?: string | null
          card_path_medium?: string | null
          card_path_thumb?: string | null
          created_at?: string
          draft_choice_priority?: number | null
          event_id?: string
          id?: string
          participant_id?: string
          participation_status?: string
          photo_path?: string | null
          photo_path_medium?: string | null
          photo_path_thumb?: string | null
          running_order?: number
          selected_draft_position?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_participants_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_participants_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_participants_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_secrets: {
        Row: {
          created_at: string
          event_id: string
          pin_hash: string
          pin_salt: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          pin_hash: string
          pin_salt: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          pin_hash?: string
          pin_salt?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_secrets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_secrets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          active: boolean
          awards_locked: boolean
          card_back_path: string | null
          card_back_path_medium: string | null
          card_back_path_thumb: string | null
          created_at: string
          draft_locked: boolean
          draft_size: number
          event_date: string | null
          id: string
          location: string | null
          name: string
          results_locked: boolean
          running_order_locked: boolean
          splits_enabled: boolean
          status: string
          timing_mode: string
          updated_at: string
          year: number
        }
        Insert: {
          active?: boolean
          awards_locked?: boolean
          card_back_path?: string | null
          card_back_path_medium?: string | null
          card_back_path_thumb?: string | null
          created_at?: string
          draft_locked?: boolean
          draft_size?: number
          event_date?: string | null
          id?: string
          location?: string | null
          name: string
          results_locked?: boolean
          running_order_locked?: boolean
          splits_enabled?: boolean
          status?: string
          timing_mode?: string
          updated_at?: string
          year: number
        }
        Update: {
          active?: boolean
          awards_locked?: boolean
          card_back_path?: string | null
          card_back_path_medium?: string | null
          card_back_path_thumb?: string | null
          created_at?: string
          draft_locked?: boolean
          draft_size?: number
          event_date?: string | null
          id?: string
          location?: string | null
          name?: string
          results_locked?: boolean
          running_order_locked?: boolean
          splits_enabled?: boolean
          status?: string
          timing_mode?: string
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      member_codes: {
        Row: {
          claim_count: number
          claimed_at: string | null
          code_hash: string
          code_salt: string
          created_at: string
          last_claimed_at: string | null
          participant_id: string
          updated_at: string
        }
        Insert: {
          claim_count?: number
          claimed_at?: string | null
          code_hash: string
          code_salt: string
          created_at?: string
          last_claimed_at?: string | null
          participant_id: string
          updated_at?: string
        }
        Update: {
          claim_count?: number
          claimed_at?: string | null
          code_hash?: string
          code_salt?: string
          created_at?: string
          last_claimed_at?: string | null
          participant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_codes_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: true
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      pack_opens: {
        Row: {
          card_count: number
          created_at: string
          event_id: string | null
          opened_on: string
          participant_id: string
        }
        Insert: {
          card_count?: number
          created_at?: string
          event_id?: string | null
          opened_on: string
          participant_id: string
        }
        Update: {
          card_count?: number
          created_at?: string
          event_id?: string | null
          opened_on?: string
          participant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pack_opens_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pack_opens_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pack_opens_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      participants: {
        Row: {
          active: boolean
          bio: string | null
          created_at: string
          fantasy_team_name: string | null
          id: string
          name: string
          nickname: string | null
          profile_image_url: string | null
          team_logo_url: string | null
          trash_talk_quote: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          bio?: string | null
          created_at?: string
          fantasy_team_name?: string | null
          id?: string
          name: string
          nickname?: string | null
          profile_image_url?: string | null
          team_logo_url?: string | null
          trash_talk_quote?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          bio?: string | null
          created_at?: string
          fantasy_team_name?: string | null
          id?: string
          name?: string
          nickname?: string | null
          profile_image_url?: string | null
          team_logo_url?: string | null
          trash_talk_quote?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      penalties: {
        Row: {
          client_key: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          penalty_ms: number
          reason: string | null
          run_id: string
          station_id: string | null
        }
        Insert: {
          client_key?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          penalty_ms: number
          reason?: string | null
          run_id: string
          station_id?: string | null
        }
        Update: {
          client_key?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          penalty_ms?: number
          reason?: string | null
          run_id?: string
          station_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "penalties_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penalties_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
        ]
      }
      running_order_randomizations: {
        Row: {
          event_id: string
          id: string
          previous_order: Json | null
          randomization_seed: string | null
          randomized_at: string
          randomized_by: string | null
          randomized_scope: string | null
          resulting_order: Json | null
        }
        Insert: {
          event_id: string
          id?: string
          previous_order?: Json | null
          randomization_seed?: string | null
          randomized_at?: string
          randomized_by?: string | null
          randomized_scope?: string | null
          resulting_order?: Json | null
        }
        Update: {
          event_id?: string
          id?: string
          previous_order?: Json | null
          randomization_seed?: string | null
          randomized_at?: string
          randomized_by?: string | null
          randomized_scope?: string | null
          resulting_order?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "running_order_randomizations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "running_order_randomizations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          attempt_number: number
          client_key: string | null
          created_at: string
          event_id: string
          finished_at: string | null
          id: string
          is_official: boolean
          notes: string | null
          official_time_ms: number | null
          participant_id: string
          paused_duration_ms: number
          penalty_ms: number
          raw_time_ms: number | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_number?: number
          client_key?: string | null
          created_at?: string
          event_id: string
          finished_at?: string | null
          id?: string
          is_official?: boolean
          notes?: string | null
          official_time_ms?: number | null
          participant_id: string
          paused_duration_ms?: number
          penalty_ms?: number
          raw_time_ms?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_number?: number
          client_key?: string | null
          created_at?: string
          event_id?: string
          finished_at?: string | null
          id?: string
          is_official?: boolean
          notes?: string | null
          official_time_ms?: number | null
          participant_id?: string
          paused_duration_ms?: number
          penalty_ms?: number
          raw_time_ms?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      secret_card_pulls: {
        Row: {
          created_at: string
          event_id: string | null
          granted: boolean
          guest_id: string | null
          id: string
          is_duplicate: boolean
          participant_id: string | null
          pulled_on: string
          secret_card_id: string
          tier: string
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          granted?: boolean
          guest_id?: string | null
          id?: string
          is_duplicate?: boolean
          participant_id?: string | null
          pulled_on: string
          secret_card_id: string
          tier?: string
        }
        Update: {
          created_at?: string
          event_id?: string | null
          granted?: boolean
          guest_id?: string | null
          id?: string
          is_duplicate?: boolean
          participant_id?: string | null
          pulled_on?: string
          secret_card_id?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "secret_card_pulls_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secret_card_pulls_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secret_card_pulls_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secret_card_pulls_secret_card_id_fkey"
            columns: ["secret_card_id"]
            isOneToOne: false
            referencedRelation: "secret_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      secret_cards: {
        Row: {
          active: boolean
          art_path: string | null
          back_path: string | null
          border_fx: string
          collection: string | null
          created_at: string
          flavour: string | null
          foil: string
          id: string
          name: string
          updated_at: string
          weight: number
        }
        Insert: {
          active?: boolean
          art_path?: string | null
          back_path?: string | null
          border_fx?: string
          collection?: string | null
          created_at?: string
          flavour?: string | null
          foil?: string
          id?: string
          name: string
          updated_at?: string
          weight?: number
        }
        Update: {
          active?: boolean
          art_path?: string | null
          back_path?: string | null
          border_fx?: string
          collection?: string | null
          created_at?: string
          flavour?: string | null
          foil?: string
          id?: string
          name?: string
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      splits: {
        Row: {
          client_key: string | null
          corrected: boolean
          correction_reason: string | null
          created_at: string
          cumulative_time_ms: number
          entry_method: string
          id: string
          recorded_at: string
          recorded_by: string | null
          run_id: string
          segment_time_ms: number | null
          station_id: string
          updated_at: string
        }
        Insert: {
          client_key?: string | null
          corrected?: boolean
          correction_reason?: string | null
          created_at?: string
          cumulative_time_ms: number
          entry_method?: string
          id?: string
          recorded_at?: string
          recorded_by?: string | null
          run_id: string
          segment_time_ms?: number | null
          station_id: string
          updated_at?: string
        }
        Update: {
          client_key?: string | null
          corrected?: boolean
          correction_reason?: string | null
          created_at?: string
          cumulative_time_ms?: number
          entry_method?: string
          id?: string
          recorded_at?: string
          recorded_by?: string | null
          run_id?: string
          segment_time_ms?: number | null
          station_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "splits_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "splits_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
        ]
      }
      stations: {
        Row: {
          active: boolean
          attempts_allowed: number
          created_at: string
          description: string | null
          event_id: string
          icon: string | null
          id: string
          name: string
          penalty_amount_ms: number
          penalty_rule: string | null
          short_name: string | null
          split_enabled: boolean
          station_order: number
          station_type: string
          success_required: boolean
          tiebreaker_station: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          attempts_allowed?: number
          created_at?: string
          description?: string | null
          event_id: string
          icon?: string | null
          id?: string
          name: string
          penalty_amount_ms?: number
          penalty_rule?: string | null
          short_name?: string | null
          split_enabled?: boolean
          station_order?: number
          station_type?: string
          success_required?: boolean
          tiebreaker_station?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          attempts_allowed?: number
          created_at?: string
          description?: string | null
          event_id?: string
          icon?: string | null
          id?: string
          name?: string
          penalty_amount_ms?: number
          penalty_rule?: string | null
          short_name?: string | null
          split_enabled?: boolean
          station_order?: number
          station_type?: string
          success_required?: boolean
          tiebreaker_station?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      events_public: {
        Row: {
          active: boolean | null
          awards_locked: boolean | null
          created_at: string | null
          draft_locked: boolean | null
          draft_size: number | null
          event_date: string | null
          id: string | null
          location: string | null
          name: string | null
          results_locked: boolean | null
          running_order_locked: boolean | null
          splits_enabled: boolean | null
          status: string | null
          timing_mode: string | null
          updated_at: string | null
          year: number | null
        }
        Insert: {
          active?: boolean | null
          awards_locked?: boolean | null
          created_at?: string | null
          draft_locked?: boolean | null
          draft_size?: number | null
          event_date?: string | null
          id?: string | null
          location?: string | null
          name?: string | null
          results_locked?: boolean | null
          running_order_locked?: boolean | null
          splits_enabled?: boolean | null
          status?: string | null
          timing_mode?: string | null
          updated_at?: string | null
          year?: number | null
        }
        Update: {
          active?: boolean | null
          awards_locked?: boolean | null
          created_at?: string | null
          draft_locked?: boolean | null
          draft_size?: number | null
          event_date?: string | null
          id?: string | null
          location?: string | null
          name?: string | null
          results_locked?: boolean | null
          running_order_locked?: boolean | null
          splits_enabled?: boolean | null
          status?: string | null
          timing_mode?: string | null
          updated_at?: string | null
          year?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      card_edition_rank: { Args: { _edition: string }; Returns: number }
      cast_award_vote: {
        Args: {
          _category: string
          _event_id: string
          _target_participant_id: string
          _voter_participant_id: string
        }
        Returns: undefined
      }
      claim_guest_secrets: {
        Args: { _guest_id: string; _participant_id: string }
        Returns: number
      }
      close_award_voting: {
        Args: { _categories: Json; _event_id: string }
        Returns: number
      }
      grant_secret_card: {
        Args: {
          _event_id: string
          _participant_id: string
          _secret_card_id: string
        }
        Returns: Json
      }
      pull_secret_card: {
        Args: { _event_id: string; _guest_id: string; _participant_id: string }
        Returns: Json
      }
      record_card_pulls: {
        Args: {
          _editions?: string[]
          _event_participant_ids: string[]
          _participant_id: string
        }
        Returns: number
      }
      record_pack_open: {
        Args: {
          _card_count?: number
          _event_id?: string
          _participant_id: string
        }
        Returns: number
      }
      reopen_award_voting: { Args: { _event_id: string }; Returns: undefined }
      resync_card_pull: {
        Args: { _event_participant_id: string; _participant_id: string }
        Returns: undefined
      }
      roll_secret_tier: { Args: never; Returns: string }
      secret_pull_status: {
        Args: { _guest_id: string; _participant_id: string }
        Returns: Json
      }
      secret_tier_rank: { Args: { _tier: string }; Returns: number }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
