import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { publicEnv } from "@/lib/public-env";

// Service-role Auth admin client. Server only (ENG-08); used to invite team members.
export function supabaseAdmin() {
  const key = env().SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set; inviting members needs it");
  return createClient(publicEnv.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
