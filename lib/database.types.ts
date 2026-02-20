export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      items: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          status: string | null;
          created_at: string;
          owner_id: string | null;
          photo_url: string | null;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          status?: string | null;
          created_at?: string;
          owner_id?: string | null;
          photo_url?: string | null;
        };
        Update: {
          title?: string;
          description?: string | null;
          status?: string | null;
          owner_id?: string | null;
          photo_url?: string | null;
        };
        Relationships: [];
      };

      interests: {
        Row: {
          id: string;
          item_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          item_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };

      item_photos: {
        Row: {
          id: string;
          item_id: string;
          photo_url: string;
          storage_path: string | null;
          created_at: string;
          owner_id: string | null;
        };
        Insert: {
          id?: string;
          item_id: string;
          photo_url: string;
          storage_path?: string | null;
          created_at?: string;
          owner_id?: string | null;
        };
        Update: {
          photo_url?: string;
          storage_path?: string | null;
          owner_id?: string | null;
        };
        Relationships: [];
      };
    };

    Views: {
      v_feed_items: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          status: string | null;
          created_at: string;
          photo_url: string | null;
          interest_count: number;
        };
        Relationships: [];
      };
    };

    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
};