import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnvironment } from "./env";

export function createSupabaseBrowserClient() {
  const environment = getSupabaseEnvironment();
  if (!environment) throw new Error("Supabase is not configured");
  return createBrowserClient(environment.url, environment.key);
}
