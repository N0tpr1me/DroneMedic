import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

let supabase: SupabaseClient<Database>;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
} else {
  // No Supabase credentials — create a placeholder client that won't crash.
  // Auth calls will fail gracefully; use demo mode to bypass login.
  console.warn(
    "[DroneMedic] Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in web/.env to enable auth. Using demo mode."
  );
  supabase = createClient<Database>(
    "https://placeholder.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder"
  );
}

export { supabase };
export type { Database };
