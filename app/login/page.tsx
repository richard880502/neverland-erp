import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const returnTo = (await searchParams).returnTo;
  if (await getCurrentUser()) redirect(returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/");
  return (
    <div className="login-page">
      <section className="login-hero">
        <header className="login-brand-header">
          <div className="login-wordmark">NEVERLAND</div>
          <div className="login-brand-meta">
            <span>OPERATIONS SYSTEM</span>
            <span>PRIVATE ACCESS</span>
          </div>
        </header>

        <div className="login-editorial">
          <div className="login-issue-line">
            <span>NL / 01</span>
            <span>TAIPEI — EST. 2025</span>
          </div>
          <h1>KEEP THE<br />STORY <em>moving.</em></h1>
          <p>從庫存、寄賣到銷售數據，把品牌每天的流動整理成清楚、可追溯的營運節奏。</p>
          <div className="login-index">
            <strong>01</strong>
            <span>STOCK<br />CHANNEL<br />SALES</span>
          </div>
        </div>

        <footer className="login-hero-footer">
          <span>NEVERLAND STUDIO®</span>
          <span>INTERNAL MANAGEMENT / 2026</span>
        </footer>
      </section>
      <section className="login-panel">
        <div className="login-panel-top">
          <span>AUTHORIZED PERSONNEL ONLY</span>
          <span>01 — LOGIN</span>
        </div>
        <div className="login-card">
          <span className="login-card-kicker">NEVERLAND / OPERATIONS</span>
          <h2>登入管理系統</h2>
          <p>使用你的管理員帳號，進入庫存與銷售後台。</p>
          <LoginForm returnTo={returnTo} />
          <div className="login-security-note">
            <span aria-hidden="true">◆</span>
            <p>安全連線已啟用<br /><small>支援 Google Authenticator 雙重驗證</small></p>
          </div>
        </div>
        <div className="login-panel-footer">NEVERLAND OPERATIONS © 2026</div>
      </section>
    </div>
  );
}
