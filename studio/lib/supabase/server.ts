import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnvironment } from "./env";

export async function createSupabaseServerClient() {
  const environment = getSupabaseEnvironment();
  if (!environment) return null;

  const cookieStore = await cookies();
  return createServerClient(environment.url, environment.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; Proxy refreshes the session.
        }
      },
    },
  });
}
