"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PasswordForm({ forced = false }: { forced?: boolean }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(""); setMessage(""); const formElement = event.currentTarget; const form = new FormData(formElement);
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== form.get("confirmPassword")) { setError("兩次輸入的新密碼不同"); setLoading(false); return; }
    const response = await fetch("/api/account/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword }) });
    const result = await response.json(); setLoading(false);
    if (!response.ok) return setError(result.error ?? "密碼變更失敗");
    formElement.reset(); setMessage("密碼已更新，其他登入裝置已登出。"); router.push("/"); router.refresh();
  }
  return <section className="panel password-panel">
    <div className="panel-header"><div><h2>{forced ? "首次登入，請設定新密碼" : "變更密碼"}</h2>{forced && <p className="muted">完成密碼變更後才能使用庫存系統。</p>}</div></div>
    {error && <div className="form-error">{error}</div>}{message && <div className="success-message">{message}</div>}
    <form className="form-grid" onSubmit={submit}>
      <div className="field wide"><label htmlFor="current-password">目前密碼</label><input className="input" id="current-password" name="currentPassword" type="password" autoComplete="current-password" required /></div>
      <div className="field"><label htmlFor="new-password">新密碼</label><input className="input" id="new-password" name="newPassword" type="password" autoComplete="new-password" minLength={10} required /><span className="helper">至少 10 字元，包含英文大小寫與數字。</span></div>
      <div className="field"><label htmlFor="confirm-password">確認新密碼</label><input className="input" id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required /></div>
      <div className="wide"><button className="btn btn-primary" disabled={loading}>{loading ? "更新中…" : "更新密碼"}</button></div>
    </form>
  </section>;
}
