"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, CheckCircle2, Copy, ExternalLink, Link2, ShieldCheck, Sparkles, Terminal, XCircle } from "lucide-react";

type Connection = {
  id: string;
  clientId: string;
  clientName: string | null;
  scopes: string[];
  createdAt: string | Date;
  lastUsedAt: string | Date | null;
  revokedAt: string | Date | null;
};
type Platform = "chatgpt" | "codex";

const displayDate = (value: string | Date | null) =>
  value ? new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "尚未使用";

function publicMcpUrl(configuredOrigin: string | undefined, browserOrigin: string): string {
  const candidate = (configuredOrigin || browserOrigin).trim();
  try {
    const url = new URL(candidate);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    // OAuth and remote MCP connections require a publicly reachable HTTPS origin.
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) return "";
    return url.origin + "/mcp";
  } catch {
    return "";
  }
}

const subscribeToOrigin = () => () => {};
const getBrowserOrigin = () => window.location.origin;
const getServerOrigin = () => "";

export function McpConnectionsManager({
  initialConnections,
  configuredOrigin,
}: {
  initialConnections: Connection[];
  configuredOrigin?: string;
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [platform, setPlatform] = useState<Platform>("chatgpt");
  const browserOrigin = useSyncExternalStore(subscribeToOrigin, getBrowserOrigin, getServerOrigin);
  const mcpUrl = publicMcpUrl(configuredOrigin, browserOrigin);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);

  const copyUrl = async () => {
    if (!mcpUrl) return;
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError("無法自動複製，請手動選取上方網址。");
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm("撤銷後，這個 AI 助理將無法再讀取或操作 ERP。要繼續嗎？")) return;
    setRevoking(id);
    setError("");
    try {
      const response = await fetch("/api/mcp/connections/" + encodeURIComponent(id), { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "撤銷失敗");
      setConnections((current) => current.map((connection) =>
        connection.id === id ? { ...connection, revokedAt: new Date().toISOString() } : connection
      ));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "撤銷失敗，請稍後再試。");
    } finally {
      setRevoking(null);
    }
  };

  const guide = platform === "chatgpt"
    ? [
        "在 ChatGPT 開啟「設定」，找到「Apps／應用程式」中的自訂 MCP App 連線設定（介面名稱可能因方案而不同）。",
        "建立新的自訂 App，將下方的 MCP 網址貼入連線網址欄位。",
        "按下連線後，依畫面提示登入 Neverland ERP，檢查並核准需要的存取權限。",
      ]
    : [
        "開啟 Codex 的 MCP 設定介面，新增一個遠端 MCP Server。",
        "將下方的 MCP 網址填入 Server URL，名稱可以設定為 neverland-erp。",
        "執行 OAuth 登入，使用 Neverland ERP 帳號登入並核准所需權限。",
      ];

  return (
    <>
      <section className="panel" aria-labelledby="mcp-setup-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CONNECT YOUR AI ASSISTANT</span>
            <h2 id="mcp-setup-title"><Sparkles size={20} aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 8 }} />連接你的 AI 助理</h2>
            <p>只要複製連線網址、貼到 AI 助理，最後登入授權，就能安全使用 ERP 功能。</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
          <button type="button" className={platform === "chatgpt" ? "btn btn-primary" : "btn btn-secondary"}
            aria-pressed={platform === "chatgpt"} onClick={() => setPlatform("chatgpt")}>
            <Sparkles size={16} aria-hidden="true" /> ChatGPT
          </button>
          <button type="button" className={platform === "codex" ? "btn btn-primary" : "btn btn-secondary"}
            aria-pressed={platform === "codex"} onClick={() => setPlatform("codex")}>
            <Terminal size={16} aria-hidden="true" /> Codex
          </button>
        </div>

        <div style={{ display: "grid", gap: 20 }}>
          <div>
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>1. 複製你的 ERP 連線網址</h3>
            <p style={{ marginBottom: 12, opacity: 0.8 }}>系統會自動填入目前網站的公開網址，不需要手動修改。</p>
            {mcpUrl ? (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border, #d1d5db)", flex: "1 1 320px", minWidth: 0, overflowWrap: "anywhere" }}>
                  <Link2 size={16} aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 8 }} />
                  <code aria-label="MCP 連線網址" style={{ userSelect: "all" }}>{mcpUrl}</code>
                </div>
                <button type="button" className="btn btn-primary" onClick={() => void copyUrl()}>
                  {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                  {copied ? "已複製" : "複製網址"}
                </button>
              </div>
            ) : (
              <p role="alert" className="form-error">尚未取得有效的公開網址。請管理員設定 NEXT_PUBLIC_APP_URL 為 HTTPS 網址。</p>
            )}
            {copyError && <p role="alert" className="form-error">{copyError}</p>}
            <p style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>這是伺服器連線位置，不是密碼。帳號權限會在登入授權時個別確認。</p>
          </div>

          <div>
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>2. 將網址貼到 {platform === "chatgpt" ? "ChatGPT" : "Codex"}</h3>
            <ol style={{ display: "grid", gap: 12, paddingLeft: 24 }}>
              {guide.map((step) => <li key={step} style={{ lineHeight: 1.7 }}>{step}</li>)}
            </ol>
            <a href={platform === "chatgpt" ? "https://chatgpt.com/" : "https://developers.openai.com/codex/"}
              target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", gap: 6, alignItems: "center", marginTop: 12 }}>
              前往 {platform === "chatgpt" ? "ChatGPT" : "Codex"} <ExternalLink size={14} aria-hidden="true" />
            </a>
            {platform === "codex" && mcpUrl && (
              <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border, #d1d5db)", borderRadius: 10, overflowWrap: "anywhere" }}>
                <p style={{ marginBottom: 6 }}>偏好終端機？也可以使用：</p>
                <code>codex mcp add neverland-erp --url {mcpUrl} --oauth-client-registration dcr</code>
                <p style={{ marginTop: 8 }}><code>codex mcp login neverland-erp</code></p>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 14, border: "1px solid var(--border, #d1d5db)", borderRadius: 10 }}>
            <ShieldCheck size={20} aria-hidden="true" style={{ flexShrink: 0 }} />
            <div>
              <h3 style={{ fontSize: 16, marginBottom: 6 }}>3. 登入 ERP 並核准權限</h3>
              <p>連線時會開啟 Neverland ERP 的登入與授權畫面。只有你允許的功能，AI 助理才能使用；也能隨時在下方撤銷。</p>
            </div>
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="mcp-connections-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CONNECTED ASSISTANTS</span>
            <h2 id="mcp-connections-title"><CheckCircle2 size={20} aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 8 }} />已連線的 AI 助理</h2>
            <p>以下連線使用獨立的 OAuth 授權，不會共用瀏覽器登入狀態。</p>
          </div>
        </div>
        {error && <p role="alert" className="form-error">{error}</p>}
        {connections.length === 0 ? (
          <p className="empty-state">目前還沒有已授權的 AI 助理。按照上方步驟連線後，就能在這裡管理。</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>AI 助理</th><th>授權範圍</th><th>建立時間</th><th>最後使用</th><th>狀態</th><th>操作</th></tr></thead>
              <tbody>
                {connections.map((connection) => (
                  <tr key={connection.id}>
                    <td><b>{connection.clientName ?? connection.clientId}</b><br /><small>{connection.clientId}</small></td>
                    <td><small>{connection.scopes.join(", ")}</small></td>
                    <td>{displayDate(connection.createdAt)}</td>
                    <td>{displayDate(connection.lastUsedAt)}</td>
                    <td>{connection.revokedAt ? <><XCircle size={14} aria-hidden="true" /> 已撤銷</> : <><CheckCircle2 size={14} aria-hidden="true" /> 有效</>}</td>
                    <td>{!connection.revokedAt && (
                      <button type="button" className="btn btn-danger" disabled={revoking === connection.id}
                        onClick={() => void revoke(connection.id)}>
                        {revoking === connection.id ? "撤銷中…" : "撤銷授權"}
                      </button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
