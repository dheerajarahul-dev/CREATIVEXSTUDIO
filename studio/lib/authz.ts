import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "./supabase/server";

export const roles = ["super_admin", "agency_manager", "video_editor", "client", "external_reviewer"] as const;
export type AppRole = (typeof roles)[number];

export const getAuthContext = cache(async (workspaceId?: string) => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, is_suspended, avatar_path")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || profile.is_suspended) return null;

  let membershipQuery = supabase
    .from("workspace_memberships")
    .select("workspace_id, role, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (workspaceId) membershipQuery = membershipQuery.eq("workspace_id", workspaceId);
  const { data: membership, error: membershipError } = await membershipQuery.limit(1).maybeSingle();
  if (membershipError || !membership || !roles.includes(membership.role as AppRole)) return null;

  return { supabase, user, profile, role: membership.role as AppRole, workspaceId: membership.workspace_id as string };
});

export function roleAllowed(role: AppRole, allowed: readonly AppRole[]) {
  return allowed.includes(role);
}
