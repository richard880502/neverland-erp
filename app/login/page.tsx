import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const returnTo = (await searchParams).returnTo;
  if (await getCurrentUser()) redirect(returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/");
  return (
    <div className="login-page">
      <main className="login-shell">
        <div className="login-brand-lockup">
          <span className="brand-mark">N</span>
          <span><strong>Neverland</strong><span>Operations</span></span>
        </div>
        <section className="login-card">
          <span className="login-card-kicker">管理後台</span>
          <h1>登入 Neverland</h1>
          <p>使用你的內部帳號進入庫存、銷售與營運管理系統。</p>
          <LoginForm returnTo={returnTo} />
          <div className="login-security-note">
            <ShieldCheck size={15} aria-hidden="true" />
            <p>安全登入已啟用<br /><small>支援 Google Authenticator 雙重驗證</small></p>
          </div>
        </section>
        <footer className="login-footer">Neverland Operations · Internal management</footer>
      </main>
    </div>
  );
}
