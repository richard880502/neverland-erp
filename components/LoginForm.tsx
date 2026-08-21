"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ returnTo }: { returnTo?: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setLoading(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    const result = await response.json();
    if (!response.ok) { setError(result.error ?? "登入失敗"); setLoading(false); return; }
    if (result.requiresTwoFactor) { setRequiresTwoFactor(true); setLoading(false); return; }
    router.push(result.mustChangePassword ? "/account" : safeReturnTo(returnTo)); router.refresh();
  }

  async function verifySecondFactor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setLoading(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/totp/verify", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: form.get("code") }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "驗證失敗"); setLoading(false);
      if (result.restart) setRequiresTwoFactor(false);
      return;
    }
    router.push(result.usedRecoveryCode ? "/account?recovery=used" : result.mustChangePassword ? "/account" : safeReturnTo(returnTo)); router.refresh();
  }

  async function backToPassword() {
    await fetch("/api/auth/totp/verify", { method: "DELETE" });
    setError(""); setRequiresTwoFactor(false);
  }

  if (requiresTwoFactor) return (
    <form className="login-form" onSubmit={verifySecondFactor}>
      <div className="login-step"><span className="badge green">第二步</span><h3>輸入驗證碼</h3><p>開啟 Google Authenticator，輸入目前顯示的 6 位數字；也可以使用一組備援碼。</p></div>
      {error && <div className="form-error">{error}</div>}
      <div className="field"><label htmlFor="two-factor-code">驗證碼或備援碼</label><input className="input otp-input" id="two-factor-code" name="code" autoComplete="one-time-code" inputMode="text" autoFocus required /></div>
      <button className="btn btn-primary btn-block" disabled={loading}>{loading ? "驗證中…" : "驗證並登入"}</button>
      <button className="text-button" type="button" onClick={backToPassword} disabled={loading}>返回帳號密碼</button>
    </form>
  );

  return (
    <form className="login-form" onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}
      <div className="field"><label htmlFor="email">電子郵件</label><input autoComplete="username" className="input" id="email" name="email" placeholder="name@example.com" type="email" required /></div>
      <div className="field"><label htmlFor="password">密碼</label><input autoComplete="current-password" className="input" id="password" name="password" placeholder="請輸入密碼" type="password" required /></div>
      <button className="btn btn-primary btn-block" disabled={loading}>{loading ? "登入中…" : "登入系統"}</button>
    </form>
  );
}

function safeReturnTo(value?: string) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}
