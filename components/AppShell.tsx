import Link from "next/link";
import { BarChart3, Boxes, Bot, DatabaseZap, PackagePlus, Route, ShieldCheck, ShoppingBag, Users } from "lucide-react";

const links = [
  { href: "/", label: "營運儀表板", icon: BarChart3 },
  { href: "/inventory", label: "即時庫存", icon: Boxes },
  { href: "/movements", label: "庫存異動", icon: Route },
  { href: "/products", label: "商品主檔", icon: ShoppingBag },
  { href: "/channels", label: "通路主檔", icon: PackagePlus },
  { href: "/account", label: "帳號與安全", icon: ShieldCheck },
];

const roleLabels = { ADMIN: "管理員", STAFF: "庫存人員", VIEWER: "檢視者" } as const;

export function AppShell({ user, children }: { user: { name: string; email: string; role: keyof typeof roleLabels }; children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">NL</span><span><b>NEVERLAND</b><small>Operations / ERP</small></span></div>
        <nav className="nav">
          {links.map(({ href, label, icon: Icon }) => <Link href={href} key={href}><Icon size={18} />{label}</Link>)}
          {user.role === "ADMIN" && <Link href="/users"><Users size={18} />使用者控管</Link>}
          {user.role === "ADMIN" && <Link href="/settings/sync"><DatabaseZap size={18} />Google Sheet 同步</Link>}
          <Link href="/settings/mcp"><Bot size={18} />AI Assistants / MCP</Link>
        </nav>
        <div className="sidebar-user">
          <small className="user-label">AUTHORISED USER</small>
          <strong>{user.name}</strong><span>{user.email} · {roleLabels[user.role]}</span>
          <form action="/api/auth/logout" method="post"><button className="logout" type="submit">登出系統</button></form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
