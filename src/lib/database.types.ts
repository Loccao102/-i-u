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
      active_personal_plans: {
        Row: {
          completed_stop_ids: string[]
          current_stop_index: number
          id: string
          owner_key: string
          plan: Json
          skipped_stop_ids: string[]
          started_at: string
          updated_at: string
        }
        Insert: {
          completed_stop_ids?: string[]
          current_stop_index?: number
          id: string
          owner_key: string
          plan: Json
          skipped_stop_ids?: string[]
          started_at?: string
          updated_at?: string
        }
        Update: {
          completed_stop_ids?: string[]
          current_stop_index?: number
          id?: string
          owner_key?: string
          plan?: Json
          skipped_stop_ids?: string[]
          started_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      collection_places: {
        Row: {
          collection_id: string
          created_at: string
          owner_key: string
          place_id: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          owner_key: string
          place_id: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          owner_key?: string
          place_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_places_owner_key_collection_id_fkey"
            columns: ["owner_key", "collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["owner_key", "id"]
          },
        ]
      }
      collections: {
        Row: {
          created_at: string
          description: string
          id: string
          name: string
          owner_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id: string
          name: string
          owner_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          name?: string
          owner_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      completed_personal_plans: {
        Row: {
          completed_at: string
          completed_stop_ids: string[]
          created_at: string
          id: string
          owner_key: string
          plan: Json
          skipped_stop_ids: string[]
          started_at: string
        }
        Insert: {
          completed_at?: string
          completed_stop_ids?: string[]
          created_at?: string
          id: string
          owner_key: string
          plan: Json
          skipped_stop_ids?: string[]
          started_at: string
        }
        Update: {
          completed_at?: string
          completed_stop_ids?: string[]
          created_at?: string
          id?: string
          owner_key?: string
          plan?: Json
          skipped_stop_ids?: string[]
          started_at?: string
        }
        Relationships: []
      }
      daily_discoveries: {
        Row: {
          created_at: string
          day: string
          kind: string
          owner_key: string
          place_keys: string[]
          scenario: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          day: string
          kind: string
          owner_key: string
          place_keys: string[]
          scenario?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          day?: string
          kind?: string
          owner_key?: string
          place_keys?: string[]
          scenario?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      personal_places: {
        Row: {
          accent: string
          address: string | null
          average_for_two: string
          best_time: string
          community_note: string
          cost_confidence: number
          cost_source: string
          created_at: string
          crowd: string
          description: string
          distance_km: number
          google_place_id: string | null
          id: string
          kind: string
          latitude: number
          location: unknown
          longitude: number
          match_score: number
          name: string
          noise: string
          note: string
          open_until: string
          owner_key: string
          price_label: string
          provider_id: string | null
          public_rating: number
          scenarios: string[]
          source: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          accent?: string
          address?: string | null
          average_for_two?: string
          best_time?: string
          community_note?: string
          cost_confidence?: number
          cost_source?: string
          created_at?: string
          crowd?: string
          description?: string
          distance_km?: number
          google_place_id?: string | null
          id: string
          kind: string
          latitude: number
          location?: unknown
          longitude: number
          match_score?: number
          name: string
          noise?: string
          note?: string
          open_until?: string
          owner_key: string
          price_label?: string
          provider_id?: string | null
          public_rating?: number
          scenarios?: string[]
          source?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          accent?: string
          address?: string | null
          average_for_two?: string
          best_time?: string
          community_note?: string
          cost_confidence?: number
          cost_source?: string
          created_at?: string
          crowd?: string
          description?: string
          distance_km?: number
          google_place_id?: string | null
          id?: string
          kind?: string
          latitude?: number
          location?: unknown
          longitude?: number
          match_score?: number
          name?: string
          noise?: string
          note?: string
          open_until?: string
          owner_key?: string
          price_label?: string
          provider_id?: string | null
          public_rating?: number
          scenarios?: string[]
          source?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      personal_ratings: {
        Row: {
          contexts: string[]
          note: string
          owner_key: string
          place_id: string
          revisit: string
          stars: number
          updated_at: string
          visited_at: string
        }
        Insert: {
          contexts?: string[]
          note?: string
          owner_key: string
          place_id: string
          revisit: string
          stars: number
          updated_at?: string
          visited_at: string
        }
        Update: {
          contexts?: string[]
          note?: string
          owner_key?: string
          place_id?: string
          revisit?: string
          stars?: number
          updated_at?: string
          visited_at?: string
        }
        Relationships: []
      }
      place_user_photos: {
        Row: {
          caption: string
          created_at: string
          id: string
          owner_key: string
          place_id: string
          storage_path: string
        }
        Insert: {
          caption?: string
          created_at?: string
          id: string
          owner_key: string
          place_id: string
          storage_path: string
        }
        Update: {
          caption?: string
          created_at?: string
          id?: string
          owner_key?: string
          place_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "place_user_photos_owner_key_place_id_fkey"
            columns: ["owner_key", "place_id"]
            isOneToOne: false
            referencedRelation: "personal_places"
            referencedColumns: ["owner_key", "id"]
          },
        ]
      }
      recommendation_feedback: {
        Row: {
          created_at: string
          distance_km: number | null
          owner_key: string
          place_id: string
          reason: string
          scenario: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          distance_km?: number | null
          owner_key: string
          place_id: string
          reason: string
          scenario?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          distance_km?: number | null
          owner_key?: string
          place_id?: string
          reason?: string
          scenario?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_feedback_owner_key_place_id_fkey"
            columns: ["owner_key", "place_id"]
            isOneToOne: true
            referencedRelation: "personal_places"
            referencedColumns: ["owner_key", "id"]
          },
        ]
      }
      saved_places: {
        Row: {
          created_at: string
          owner_key: string
          place_id: string
        }
        Insert: {
          created_at?: string
          owner_key: string
          place_id: string
        }
        Update: {
          created_at?: string
          owner_key?: string
          place_id?: string
        }
        Relationships: []
      }
      visits: {
        Row: {
          created_at: string
          id: string
          owner_key: string
          place_id: string
          rating_stars: number | null
          visited_at: string
        }
        Insert: {
          created_at?: string
          id: string
          owner_key: string
          place_id: string
          rating_stars?: number | null
          visited_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_key?: string
          place_id?: string
          rating_stars?: number | null
          visited_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_active_personal_plan: {
        Args: {
          p_action: string
          p_expected_index: number
          p_owner_key: string
        }
        Returns: Json
      }
      delete_personal_place: {
        Args: { p_owner_key: string; p_place_id: string }
        Returns: boolean
      }
      nearby_personal_places: {
        Args: {
          p_lat: number
          p_limit?: number
          p_long: number
          p_owner_key: string
        }
        Returns: {
          distance_meters: number
          id: string
          latitude: number
          longitude: number
          name: string
        }[]
      }
      viewport_personal_places: {
        Args: {
          p_east: number
          p_limit?: number
          p_north: number
          p_owner_key: string
          p_south: number
          p_west: number
        }
        Returns: {
          id: string
          latitude: number
          longitude: number
        }[]
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
