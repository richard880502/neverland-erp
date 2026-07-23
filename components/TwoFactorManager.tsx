"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";

type SetupData = { qrDataUrl: string; manualKey: string };

export function TwoFactorManager({ enabled, recoveryCodesRemaining, recoveryCodeUsed = false }: { enabled: boolean; recoveryCodesRemaining: number; recoveryCodeUsed?: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [action, setAction] = useState<"regenerate" | "disable" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function startSetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/account/totp/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: form.get("currentPassword") }) });
    const result = await response.json(); setLoading(false);
    if (!response.ok) return setError(result.error ?? "無法開始設定");
    setSetup(result);
  }

  async function enableTwoFactor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/account/totp/enable", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: form.get("code") }) });
    const result = await response.json(); setLoading(false);
    if (!response.ok) return setError(result.error ?? "無法啟用雙重驗證");
    setRecoveryCodes(result.recoveryCodes); setSetup(null);
  }

  async function submitEnabledAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!action) return;
    setLoading(true); setError(""); setMessage("");
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const endpoint = action === "disable" ? "/api/account/totp/disable" : "/api/account/totp/recovery-codes";
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json(); setLoading(false);
    if (!response.ok) return setError(result.error ?? "操作失敗");
    if (action === "disable") { setAction(null); setMessage("雙重驗證已停用，其他登入裝置已登出。"); router.refresh(); return; }
    setRecoveryCodes(result.recoveryCodes); setAction(null);
  }

  async function copyRecoveryCodes() {
    if (!recoveryCodes) return;
    await navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setMessage("備援碼已複製。請存放在安全且不與手機相同的位置。");
  }

  if (recoveryCodes) return <section className="panel two-factor-panel">
    <div className="panel-header"><div><span className="panel-index">RECOVERY CODES</span><h2>請立即保存備援碼</h2></div><span>只顯示這一次</span></div>
    <div className="security-warning">手機遺失時，每組備援碼可代替驗證器登入一次。請勿把它們只存在同一支手機裡。</div>
    <div className="recovery-code-grid">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div>
    {message && <div className="success-message">{message}</div>}
    <div className="security-actions"><button className="btn btn-secondary" onClick={copyRecoveryCodes}><Copy size={15} />複製全部</button><button className="btn btn-primary" onClick={() => { setRecoveryCodes(null); router.refresh(); }}>我已安全保存</button></div>
  </section>;

  return <section className="panel two-factor-panel">
    <div className="panel-header"><div><span className="panel-index">TWO-FACTOR AUTHENTICATION</span><h2>Google Authenticator</h2></div><span className={`badge ${enabled ? "green" : ""}`}>{enabled ? "已啟用" : "未啟用"}</span></div>
    {recoveryCodeUsed && enabled && <div className="security-warning">你剛使用了一組備援碼登入。剩餘 {recoveryCodesRemaining} 組，建議視需要重新產生。</div>}
    {error && <div className="form-error">{error}</div>}{message && <div className="success-message">{message}</div>}

    {!enabled && !setup && <>
      <p className="two-factor-intro">登入密碼正確後，還需要輸入手機驗證器每 30 秒更新的 6 位數字。</p>
      <form className="security-form" onSubmit={startSetup}>
        <div className="field"><label htmlFor="totp-setup-password">目前密碼</label><input className="input" id="totp-setup-password" name="currentPassword" type="password" autoComplete="current-password" required /></div>
        <button className="btn btn-primary" disabled={loading}><ShieldCheck size={16} />{loading ? "準備中…" : "開始設定"}</button>
      </form>
    </>}

    {!enabled && setup && <div className="totp-setup-grid">
      <div className="totp-qr"><img src={setup.qrDataUrl} alt="Google Authenticator 設定 QR Code" /></div>
      <div><h3>1. 使用驗證器掃描</h3><p className="helper">在 Google Authenticator 點選「＋」並掃描 QR Code。無法掃描時可手動輸入金鑰：</p><code className="manual-key">{setup.manualKey}</code>
        <form className="security-form confirm-totp-form" onSubmit={enableTwoFactor}><div className="field"><label htmlFor="totp-confirm-code">2. 輸入 App 顯示的 6 位數字</label><input className="input otp-input" id="totp-confirm-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></div><button className="btn btn-primary" disabled={loading}>{loading ? "驗證中…" : "驗證並啟用"}</button></form>
      </div>
    </div>}

    {enabled && <>
      <div className="two-factor-summary"><div><span>驗證方式</span><strong>6 位 TOTP 驗證碼</strong></div><div><span>備援碼</span><strong>{recoveryCodesRemaining} 組可用</strong></div></div>
      {!action && <div className="security-actions"><button className="btn btn-secondary" onClick={() => setAction("regenerate")}><RefreshCw size={15} />重新產生備援碼</button><button className="btn btn-danger" onClick={() => setAction("disable")}><ShieldOff size={15} />停用雙重驗證</button></div>}
      {action && <form className="security-form enabled-action-form" onSubmit={submitEnabledAction}><div className="field"><label htmlFor="totp-action-password">目前密碼</label><input className="input" id="totp-action-password" name="currentPassword" type="password" autoComplete="current-password" required /></div><div className="field"><label htmlFor="totp-action-code">驗證碼或備援碼</label><input className="input otp-input" id="totp-action-code" name="code" autoComplete="one-time-code" required /></div><div className="security-actions"><button className={`btn ${action === "disable" ? "btn-danger" : "btn-primary"}`} disabled={loading}>{loading ? "處理中…" : action === "disable" ? "確認停用" : "產生新備援碼"}</button><button className="btn btn-secondary" type="button" onClick={() => { setAction(null); setError(""); }} disabled={loading}>取消</button></div></form>}
    </>}
  </section>;
}
