"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { AppRole } from "@/lib/authz";

type Props = { children: ReactNode; role: AppRole; email: string; name: string; breadcrumb?: string };

export default function WorkspaceFrame({ children, role, email, name, breadcrumb }: Props) {
  const pathname = usePathname();
  const isOverview = pathname === "/studio";
  const initials = name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "CX";
  const canManage = role === "super_admin" || role === "agency_manager";
  const label = role.replaceAll("_", " ");

  return <div className="studio-app-shell">
    <aside className="studio-sidebar">
      <Link className="studio-brand" href="/studio"><span className="brand-mark">CX</span><span>CREATIVE X<small>PRODUCTION STUDIO</small></span></Link>
      <div className="studio-workspace-switch"><span className="studio-workspace-icon">C</span><span><strong>Creative X Creations</strong><small>Private workspace</small></span><b>⌄</b></div>
      <nav className="studio-nav" aria-label="Studio navigation">
        <span className="studio-nav-label">WORKSPACE</span>
        <Link className={`studio-nav-item ${isOverview ? "active" : ""}`} href="/studio"><span>▦</span>Overview</Link>
        <Link className={`studio-nav-item ${!isOverview ? "active" : ""}`} href="/studio#projects"><span>▤</span>Projects</Link>
        <Link className="studio-nav-item" href="/studio?status=client_review#projects"><span>◉</span>Review queue</Link>
        {canManage && <><span className="studio-nav-label">OPERATIONS</span><Link className="studio-nav-item" href="/studio#requests"><span>✳</span>Client intake</Link></>}
        {role === "super_admin" && <><span className="studio-nav-label">ADMINISTRATION</span><Link className="studio-nav-item" href="/studio#team"><span>♧</span>Team access</Link></>}
      </nav>
      <div className="studio-sidebar-bottom"><div className="studio-help-note"><span>↗</span><div><strong>Need a hand?</strong><small>Contact your workspace admin</small></div></div><form action="/auth/logout" method="post" className="studio-account"><span className="studio-avatar">{initials}</span><span className="studio-account-copy"><strong>{name || email}</strong><small>{label}</small></span><button type="submit" aria-label="Sign out">↪</button></form></div>
    </aside>
    <div className="studio-main-column"><header className="studio-topbar"><div className="studio-breadcrumbs"><Link href="/studio">Workspace</Link>{breadcrumb && <><span>/</span><strong>{breadcrumb}</strong></>}</div><form className="studio-search" action="/studio" role="search"><span>⌕</span><input aria-label="Search projects" name="q" maxLength={100} placeholder="Search projects" /><kbd>↵</kbd></form><span className="studio-role-chip">{label}</span><span className="studio-top-avatar" title={email}>{initials}</span></header><div className="studio-page-content">{children}</div><footer className="studio-footer"><span>CREATIVE X STUDIO</span><span>PRIVATE PRODUCTION WORKSPACE · {label.toUpperCase()}</span></footer></div>
  </div>;
}
