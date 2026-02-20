import { supabase } from "@/lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";

let inflight: Promise<Session | null> | null = null;

export function getSessionOnce(): Promise<Session | null> {
  if (!inflight) {
    inflight = supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        return data.session ?? null;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}