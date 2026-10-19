import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/authz";
import { getSupabaseEnvironment } from "@/lib/supabase/env";
import WorkspaceFrame from "./workspace-frame";

export default function StudioLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main className="secure-shell"><div className="secure-loading">Opening your workspace…</div></main>}><AuthenticatedWorkspace>{children}</AuthenticatedWorkspace></Suspense>;
}

async function AuthenticatedWorkspace({ children }: { children: ReactNode }) {
  if (!getSupabaseEnvironment()) return children;
  const context = await getAuthContext();
  if (!context) redirect("/login?error=invalid");

  return <WorkspaceFrame role={context.role} email={context.user.email ?? ""} name={context.profile.display_name || context.user.email?.split("@")[0] || "Studio member"}>{children}</WorkspaceFrame>;
}
