"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, Boxes, DatabaseZap, KeyRound, LogOut, PackagePlus, ReceiptText, Route, ShieldCheck, ShoppingBag, Users } from "lucide-react";

const workspaceLinks = [
  { href: "/", label: "營運儀表板", icon: BarChart3 },
  { href: "/inventory", label: "即時庫存", icon: Boxes },
  { href: "/movements", label: "庫存異動", icon: Route },
  { href: "/billing", label: "請款管理", icon: ReceiptText },
  { href: "/products", label: "商品主檔", icon: ShoppingBag },
  { href: "/channels", label: "通路主檔", icon: PackagePlus },
];

const roleLabels = { ADMIN: "管理員", STAFF: "庫存人員", VIEWER: "檢視者" } as const;

function activeFor(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function pageLabel(pathname: string) {
  const allLinks = [
    ...workspaceLinks,
    { href: "/account", label: "帳號與安全" },
    { href: "/users", label: "使用者控管" },
    { href: "/settings/sync", label: "Google Sheet 同步" },
    { href: "/settings/mcp", label: "AI Assistants / MCP" },
    { href: "/settings/api-keys", label: "API Key 管理" },
  ];
  return allLinks.find((item) => activeFor(pathname, item.href))?.label ?? "Operations";
}

function initials(name: string) {
  const value = name.trim();
  if (!value) return "N";
  const cjk = value.match(/[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/);
  if (cjk) return cjk[0];
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return value.slice(0, 2).toUpperCase();
}

export function AppShell({ user, children }: { user: { name: string; email: string; role: keyof typeof roleLabels }; children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <Link className="brand" href="/" aria-label="Neverland Operations 首頁">
            <span className="brand-mark">N</span>
            <span className="brand-copy"><b>Neverland</b><small>Operations</small></span>
          </Link>
        </div>

        <nav className="nav" aria-label="主要導覽">
          <div className="nav-group">
            <span className="nav-group-label">Workspace</span>
            {workspaceLinks.map(({ href, label, icon: Icon }) => {
              const active = activeFor(pathname, href);
              return <Link className={active ? "active" : undefined} href={href} key={href} aria-current={active ? "page" : undefined}><Icon size={16} strokeWidth={1.8} />{label}</Link>;
            })}
          </div>

          <div className="nav-group">
            <span className="nav-group-label">Settings</span>
            <Link className={activeFor(pathname, "/account") ? "active" : undefined} href="/account" aria-current={activeFor(pathname, "/account") ? "page" : undefined}><ShieldCheck size={16} strokeWidth={1.8} />帳號與安全</Link>
            {user.role === "ADMIN" && <Link className={activeFor(pathname, "/users") ? "active" : undefined} href="/users" aria-current={activeFor(pathname, "/users") ? "page" : undefined}><Users size={16} strokeWidth={1.8} />使用者控管</Link>}
            {user.role === "ADMIN" && <Link className={activeFor(pathname, "/settings/sync") ? "active" : undefined} href="/settings/sync" aria-current={activeFor(pathname, "/settings/sync") ? "page" : undefined}><DatabaseZap size={16} strokeWidth={1.8} />Google Sheet 同步</Link>}
            <Link className={activeFor(pathname, "/settings/mcp") ? "active" : undefined} href="/settings/mcp" aria-current={activeFor(pathname, "/settings/mcp") ? "page" : undefined}><Bot size={16} strokeWidth={1.8} />AI Assistants / MCP</Link>
            {user.role === "ADMIN" && <Link className={activeFor(pathname, "/settings/api-keys") ? "active" : undefined} href="/settings/api-keys" aria-current={activeFor(pathname, "/settings/api-keys") ? "page" : undefined}><KeyRound size={16} strokeWidth={1.8} />API Key 管理</Link>}
          </div>
        </nav>

        <div className="sidebar-user">
          <div className="sidebar-user-card">
            <span className="sidebar-avatar" aria-hidden="true">{initials(user.name)}</span>
            <span className="sidebar-user-meta"><strong>{user.name}</strong><span>{roleLabels[user.role]} · {user.email}</span></span>
            <form action="/api/auth/logout" method="post"><button className="logout" type="submit" title="登出系統" aria-label="登出系統"><LogOut size={15} /></button></form>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-breadcrumb"><span>Neverland</span><span>/</span><strong>{pageLabel(pathname)}</strong></div>
          <div className="topbar-meta">Operations / ERP</div>
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
