"use client";

import { useState } from "react";

type Connection = { id: string; clientId: string; clientName: string | null; scopes: string[]; createdAt: string | Date; lastUsedAt: string | Date | null; revokedAt: string | Date | null };
const displayDate = (value: string | Date | null) => value ? new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "尚未使用";

export function McpConnectionsManager({ initialConnections }: { initialConnections: Connection[] }) {
  const [connections, setConnections] = useState(initialConnections); const [error, setError] = useState("");
  const revoke = async (id: string) => { if (!window.confirm("撤銷後，這個 AI Assistant 將立即無法再讀取或操作 ERP。要繼續嗎？")) return; const response = await fetch(`/api/mcp/connections/${id}`, { method: "DELETE" }); const body = await response.json(); if (!response.ok) { setError(body.error ?? "撤銷失敗"); return; } setConnections((current) => current.map((connection) => connection.id === id ? { ...connection, revokedAt: new Date().toISOString() } : connection)); };
  return <section className="panel"><div className="section-heading"><div><span className="eyebrow">AI ASSISTANTS / MCP</span><h2>已連線的 AI Assistant</h2><p>這些是獨立 OAuth credentials，不會共用你的瀏覽器登入 session。</p></div></div>{error && <p className="form-error">{error}</p>}{connections.length === 0 ? <p className="empty-state">尚未有 MCP connection。依部署文件在 ChatGPT 或 Codex 加入 <code>https://&lt;domain&gt;/mcp</code> 後，登入並授權即可建立。</p> : <div className="table-wrap"><table><thead><tr><th>Client</th><th>Scopes</th><th>建立時間</th><th>最後使用</th><th>狀態</th><th /></tr></thead><tbody>{connections.map((connection) => <tr key={connection.id}><td><b>{connection.clientName ?? connection.clientId}</b><br /><small>{connection.clientId}</small></td><td><small>{connection.scopes.join(", ")}</small></td><td>{displayDate(connection.createdAt)}</td><td>{displayDate(connection.lastUsedAt)}</td><td>{connection.revokedAt ? "已撤銷" : "有效"}</td><td>{!connection.revokedAt && <button className="btn btn-danger" onClick={() => void revoke(connection.id)}>撤銷</button>}</td></tr>)}</tbody></table></div>}</section>;
}
