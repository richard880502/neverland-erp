"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Power, PowerOff, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { channelTypeLabels } from "@/lib/inventory";

type Channel = { id: string; name: string; type: keyof typeof channelTypeLabels; active: boolean; movementCount: number };

export function ChannelManager({ channels, canWrite }: { channels: Channel[]; canWrite: boolean }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [loading, setLoading] = useState(false); const [loadingId, setLoadingId] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setMessage(""); const formElement = event.currentTarget; const form = new FormData(formElement);
    const response = await fetch("/api/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
    const result = await response.json(); setLoading(false);
    if (!response.ok) return setMessage(result.error ?? "新增失敗");
    formElement.reset(); router.refresh();
  }
  async function toggleChannel(channel: Channel) {
    setLoadingId(channel.id); setMessage("");
    const response = await fetch(`/api/channels/${channel.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !channel.active }) });
    const result = await response.json(); setLoadingId("");
    if (!response.ok) return setMessage(result.error ?? "狀態更新失敗");
    router.refresh();
  }
  async function deleteChannel(channel: Channel) {
    if (!confirm(`確定永久刪除通路「${channel.name}」？此操作無法復原。`)) return;
    setLoadingId(channel.id); setMessage("");
    const response = await fetch(`/api/channels/${channel.id}`, { method: "DELETE" });
    const result = await response.json(); setLoadingId("");
    if (!response.ok) return setMessage(result.error ?? "刪除失敗");
    router.refresh();
  }
  return <>
    <PageHeader eyebrow="Master data" title="通路主檔" description="設定直營、寄賣與買斷通路，控制庫存流向。" />
    {message && <div className="form-error">{message}</div>}
    {canWrite && <details className="panel drawer"><summary><span className="btn btn-primary"><Plus size={16} />新增通路</span></summary>
      <form className="inline-form" onSubmit={submit}>
        <div className="field"><label>通路名稱</label><input className="input" name="name" required /></div>
        <div className="field"><label>通路類型</label><select className="select" name="type" defaultValue="CONSIGNMENT">{Object.entries(channelTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
        <button className="btn btn-primary" disabled={loading}>{loading ? "儲存中…" : "建立通路"}</button>
      </form>
    </details>}
    {canWrite && <p className="master-note">已有庫存異動的通路不可永久刪除，請改用停用以保留帳務歷史。</p>}
    <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>通路名稱</th><th>類型</th><th>狀態</th>{canWrite && <th>操作</th>}</tr></thead><tbody>{channels.map((c) => <tr key={c.id} className={c.active ? undefined : "inactive-row"}><td>{c.name}</td><td><span className="badge">{channelTypeLabels[c.type]}</span></td><td><span className={`badge ${c.active ? "green" : ""}`}>{c.active ? "啟用" : "停用"}</span></td>{canWrite && <td><div className="row-actions"><button className="btn btn-secondary icon-btn" disabled={loadingId === c.id} onClick={() => toggleChannel(c)} title={c.active ? "停用通路" : "啟用通路"} aria-label={`${c.active ? "停用" : "啟用"} ${c.name}`}>{c.active ? <PowerOff size={15} /> : <Power size={15} />}</button><button className="btn btn-danger icon-btn" disabled={loadingId === c.id || c.movementCount > 0} onClick={() => deleteChannel(c)} title={c.movementCount > 0 ? `已有 ${c.movementCount} 筆異動，請改用停用` : "永久刪除通路"} aria-label={`刪除 ${c.name}`}><Trash2 size={15} /></button></div></td>}</tr>)}</tbody></table></div></div>
  </>;
}
