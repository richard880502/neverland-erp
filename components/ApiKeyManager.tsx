"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";

type ApiKey = {
  id: string;
  label: string;
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type RevealedKey = { id: string; label: string; plaintext: string };

const displayDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "從未使用";

export function ApiKeyManager({ initialApiKeys }: { initialApiKeys: ApiKey[] }) {
  const router = useRouter();
  const [apiKeys, setApiKeys] = useState(initialApiKeys);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState<RevealedKey | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!label.trim()) { setError("請輸入 label"); return; }
    setLoading(true);
    const response = await fetch("/api/admin/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: label.trim() }),
    });
    const result = await response.json();
    setLoading(false);
    if (!response.ok) { setError(result.error ?? "建立失敗"); return; }
    setLabel("");
    setCopied(false);
    setRevealed({ id: result.id, label: result.label, plaintext: result.plaintext });
    router.refresh();
  }

  async function copyPlaintext() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.plaintext);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("確定要撤銷這把 Key？撤銷後，使用這把 Key 的服務將立即無法再呼叫 API。要繼續嗎？")) return;
    const response = await fetch(`/api/admin/api-keys/${id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) { setError(result.error ?? "撤銷失敗"); return; }
    setApiKeys((current) => current.map((apiKey) => apiKey.id === id ? { ...apiKey, revokedAt: new Date().toISOString(), active: false } : apiKey));
  }

  return <>
    <PageHeader eyebrow="Settings / Integrations" title="API Key 管理" description="管理外部服務（例如 Medusa）用來呼叫 Neverland ERP 整合 API 的憑證。" />

    {revealed && <section className="panel" style={{ borderColor: "var(--green)", background: "#eef3ec", marginBottom: 18 }}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">新 API Key 已建立：{revealed.label}</span>
          <h2>請立即複製這把金鑰</h2>
          <p>基於安全考量，這把金鑰只會顯示這一次。關閉後將無法再從此頁面查看明文，遺失請重新建立一把新的 key。</p>
        </div>
      </div>
      <div className="table-wrap"><code style={{ display: "block", padding: 12, background: "#fff", border: "1px solid var(--ink)", wordBreak: "break-all" }}>{revealed.plaintext}</code></div>
      <div className="wide" style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
        <button type="button" className="btn btn-secondary" onClick={() => void copyPlaintext()}>{copied ? "已複製" : "複製到剪貼簿"}</button>
        <button type="button" className="btn btn-primary" onClick={() => setRevealed(null)}>我已複製，關閉</button>
      </div>
    </section>}

    {error && <p className="form-error">{error}</p>}

    <details className="panel drawer" open>
      <summary><span className="btn btn-primary"><KeyRound size={16} />建立新 Key</span></summary>
      <form className="form-grid" onSubmit={submit}>
        <div className="field">
          <label htmlFor="api-key-label">Label</label>
          <input className="input" id="api-key-label" name="label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：Medusa Production" maxLength={120} required />
        </div>
        <div className="wide"><button className="btn btn-primary" disabled={loading}>{loading ? "建立中…" : "建立 Key"}</button></div>
      </form>
    </details>

    <section className="panel table-panel">
      {apiKeys.length === 0 ? <p className="empty-state">尚未建立任何 API Key。</p> : <div className="table-wrap">
        <table>
          <thead><tr><th>Label</th><th>建立時間</th><th>最後使用</th><th>狀態</th><th /></tr></thead>
          <tbody>{apiKeys.map((apiKey) => <tr key={apiKey.id}>
            <td><b>{apiKey.label}</b></td>
            <td>{displayDate(apiKey.createdAt)}</td>
            <td>{displayDate(apiKey.lastUsedAt)}</td>
            <td><span className={`badge ${apiKey.revokedAt ? "warn" : "green"}`}>{apiKey.revokedAt ? "已撤銷" : "啟用中"}</span></td>
            <td>{!apiKey.revokedAt && <button className="btn btn-danger" onClick={() => void revoke(apiKey.id)}>撤銷</button>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
  </>;
}
