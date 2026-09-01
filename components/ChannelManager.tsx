"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Power, PowerOff, Plus, Settings2, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { channelTypeLabels } from "@/lib/inventory";

type Channel = {
  id: string;
  name: string;
  type: keyof typeof channelTypeLabels;
  active: boolean;
  movementCount: number;
  billingCount: number;
  companyName: string | null;
  taxId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  billingAddress: string | null;
  settlementRate: number | null;
  taxRate: number | null;
  paymentTermsDays: number | null;
  defaultShippingMethod: string | null;
  defaultShippingFee: number | null;
  defaultShippingPayer: string | null;
};

type ChannelDraft = {
  companyName: string;
  taxId: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  billingAddress: string;
  settlementPercent: string;
  taxPercent: string;
  paymentTermsDays: string;
  defaultShippingMethod: string;
  defaultShippingFee: string;
  defaultShippingPayer: string;
};

const shippingMethods = ["7-11 店到店", "全家店到店", "郵局", "黑貓宅急便", "新竹物流", "Lalamove", "親送", "店取", "其他"];
const payerLabels: Record<string, string> = { COMPANY: "公司負擔", CUSTOMER: "客戶負擔", CHANNEL: "通路負擔", SUPPLIER: "供應商負擔" };

function supportsBilling(channel: Channel) {
  return channel.type === "CONSIGNMENT" || channel.type === "BUYOUT";
}

function toDraft(channel: Channel): ChannelDraft {
  return {
    companyName: channel.companyName ?? channel.name,
    taxId: channel.taxId ?? "",
    contactName: channel.contactName ?? "",
    contactEmail: channel.contactEmail ?? "",
    contactPhone: channel.contactPhone ?? "",
    billingAddress: channel.billingAddress ?? "",
    settlementPercent: channel.settlementRate == null ? "" : String(channel.settlementRate * 100),
    taxPercent: channel.taxRate == null ? "5" : String(channel.taxRate * 100),
    paymentTermsDays: String(channel.paymentTermsDays ?? 0),
    defaultShippingMethod: channel.defaultShippingMethod ?? "",
    defaultShippingFee: channel.defaultShippingFee == null ? "" : String(channel.defaultShippingFee),
    defaultShippingPayer: channel.defaultShippingPayer ?? "COMPANY",
  };
}

function shippingSummary(channel: Channel) {
  if (!channel.defaultShippingMethod && channel.defaultShippingFee == null && !channel.defaultShippingPayer) return "物流未設定";
  return [
    channel.defaultShippingMethod || "未指定方式",
    channel.defaultShippingFee == null ? null : `NT$ ${channel.defaultShippingFee.toLocaleString("zh-TW")}`,
    channel.defaultShippingPayer ? payerLabels[channel.defaultShippingPayer] ?? channel.defaultShippingPayer : null,
  ].filter(Boolean).join(" · ");
}

export function ChannelManager({ channels, canWrite }: { channels: Channel[]; canWrite: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState("");
  const [editing, setEditing] = useState<Channel | null>(null);
  const [draft, setDraft] = useState<ChannelDraft | null>(null);

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

  function editSettings(channel: Channel) {
    setEditing(channel); setDraft(toDraft(channel)); setMessage("");
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || !draft) return;
    setLoadingId(editing.id); setMessage("");
    const nullable = (value: string) => value.trim() || null;
    const payload: Record<string, unknown> = {
      defaultShippingMethod: nullable(draft.defaultShippingMethod),
      defaultShippingFee: draft.defaultShippingFee === "" ? null : Number(draft.defaultShippingFee),
      defaultShippingPayer: nullable(draft.defaultShippingPayer),
    };
    if (supportsBilling(editing)) {
      Object.assign(payload, {
        companyName: nullable(draft.companyName),
        taxId: nullable(draft.taxId),
        contactName: nullable(draft.contactName),
        contactEmail: nullable(draft.contactEmail),
        contactPhone: nullable(draft.contactPhone),
        billingAddress: nullable(draft.billingAddress),
        settlementRate: draft.settlementPercent === "" ? null : Number(draft.settlementPercent) / 100,
        taxRate: draft.taxPercent === "" ? null : Number(draft.taxPercent) / 100,
        paymentTermsDays: Number(draft.paymentTermsDays || 0),
      });
    }
    const response = await fetch(`/api/channels/${editing.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json(); setLoadingId("");
    if (!response.ok) return setMessage(result.error ?? "通路設定儲存失敗");
    setEditing(null); setDraft(null); router.refresh();
  }

  return <>
    <PageHeader eyebrow="Master data" title="通路主檔" description="通路的商務條件、請款資料與物流預設統一在同一個設定入口管理。" />
    {message && <div className="form-error">{message}</div>}
    {canWrite && <details className="panel drawer"><summary><span className="btn btn-primary"><Plus size={16} />新增通路</span></summary>
      <form className="inline-form" onSubmit={submit}>
        <div className="field"><label>通路名稱</label><input className="input" name="name" required /></div>
        <div className="field"><label>通路類型</label><select className="select" name="type" defaultValue="CONSIGNMENT">{Object.entries(channelTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
        <button className="btn btn-primary" disabled={loading}>{loading ? "儲存中…" : "建立通路"}</button>
      </form>
    </details>}
    {canWrite && <p className="master-note">已有庫存異動或請款單的通路不可永久刪除，請改用停用以保留帳務歷史。</p>}

    <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>通路名稱</th><th>類型</th><th>設定摘要</th><th>狀態</th>{canWrite && <th>操作</th>}</tr></thead><tbody>{channels.map((channel) => <tr key={channel.id} className={channel.active ? undefined : "inactive-row"}>
      <td><strong>{channel.name}</strong></td>
      <td><span className="badge">{channelTypeLabels[channel.type]}</span></td>
      <td><div className="channel-billing-summary">
        {supportsBilling(channel) && <span>{channel.settlementRate == null ? "結算比例未設定" : `結算 ${channel.settlementRate * 100}%`} · 稅 {channel.taxRate == null ? "未設定" : `${channel.taxRate * 100}%`} · {channel.paymentTermsDays ?? 0} 天</span>}
        <span>{shippingSummary(channel)}</span>
      </div></td>
      <td><span className={`badge ${channel.active ? "green" : ""}`}>{channel.active ? "啟用" : "停用"}</span></td>
      {canWrite && <td><div className="row-actions">
        <button className="btn btn-secondary icon-btn" onClick={() => editSettings(channel)} title="編輯通路設定" aria-label={`編輯 ${channel.name} 通路設定`}><Settings2 size={15} /></button>
        <button className="btn btn-secondary icon-btn" disabled={loadingId === channel.id} onClick={() => toggleChannel(channel)} title={channel.active ? "停用通路" : "啟用通路"} aria-label={`${channel.active ? "停用" : "啟用"} ${channel.name}`}>{channel.active ? <PowerOff size={15} /> : <Power size={15} />}</button>
        <button className="btn btn-danger icon-btn" disabled={loadingId === channel.id || channel.movementCount > 0 || channel.billingCount > 0} onClick={() => deleteChannel(channel)} title={channel.movementCount > 0 || channel.billingCount > 0 ? "已有關聯帳務，請改用停用" : "永久刪除通路"} aria-label={`刪除 ${channel.name}`}><Trash2 size={15} /></button>
      </div></td>}
    </tr>)}</tbody></table></div></div>

    {editing && draft && <section className="panel channel-billing-editor">
      <datalist id="channel-shipping-methods">{shippingMethods.map((name) => <option value={name} key={name} />)}</datalist>
      <div className="billing-list-head"><div><span>CHANNEL SETTINGS</span><h2>{editing.name} · 通路設定</h2><p className="helper">商務、請款與物流預設集中管理；庫存異動仍可覆寫當次物流資訊。</p></div><button className="btn btn-secondary icon-btn" onClick={() => { setEditing(null); setDraft(null); }} aria-label="關閉"><X size={16} /></button></div>
      <form onSubmit={saveSettings}>
        <div style={{ marginBottom: 22 }}>
          <div className="billing-list-head" style={{ marginBottom: 12 }}><div><span>CHANNEL</span><h3>通路資訊</h3></div></div>
          <div className="billing-two-col">
            <div className="field"><label>通路名稱</label><div className="input" style={{ display: "flex", alignItems: "center", background: "var(--surface-subtle)" }}>{editing.name}</div></div>
            <div className="field"><label>通路類型</label><div className="input" style={{ display: "flex", alignItems: "center", background: "var(--surface-subtle)" }}>{channelTypeLabels[editing.type]}</div></div>
          </div>
        </div>

        {supportsBilling(editing) && <div style={{ marginBottom: 22 }}>
          <div className="billing-list-head" style={{ marginBottom: 12 }}><div><span>COMMERCIAL & BILLING</span><h3>商務 / 請款設定</h3></div></div>
          <div className="billing-three-col">
            <div className="field"><label>公司 / 客戶名稱</label><input className="input" value={draft.companyName} onChange={(event) => setDraft({ ...draft, companyName: event.target.value })} /></div>
            <div className="field"><label>統一編號</label><input className="input" value={draft.taxId} onChange={(event) => setDraft({ ...draft, taxId: event.target.value })} /></div>
            <div className="field"><label>聯絡人</label><input className="input" value={draft.contactName} onChange={(event) => setDraft({ ...draft, contactName: event.target.value })} /></div>
            <div className="field"><label>Email</label><input className="input" type="email" value={draft.contactEmail} onChange={(event) => setDraft({ ...draft, contactEmail: event.target.value })} /></div>
            <div className="field"><label>電話 / 手機</label><input className="input" value={draft.contactPhone} onChange={(event) => setDraft({ ...draft, contactPhone: event.target.value })} /></div>
            <div className="field"><label>付款天數</label><input className="input" type="number" min="0" max="365" value={draft.paymentTermsDays} onChange={(event) => setDraft({ ...draft, paymentTermsDays: event.target.value })} /></div>
          </div>
          <div className="field"><label>公司地址</label><input className="input" value={draft.billingAddress} onChange={(event) => setDraft({ ...draft, billingAddress: event.target.value })} /></div>
          <div className="billing-two-col">
            <div className="field"><label>預設結算比例 (%)</label><input className="input" type="number" min="0" max="100" step="0.01" placeholder="例如 60" value={draft.settlementPercent} onChange={(event) => setDraft({ ...draft, settlementPercent: event.target.value })} /></div>
            <div className="field"><label>預設營業稅 (%)</label><input className="input" type="number" min="0" max="100" step="0.01" value={draft.taxPercent} onChange={(event) => setDraft({ ...draft, taxPercent: event.target.value })} /></div>
          </div>
        </div>}

        <div style={{ marginBottom: 22 }}>
          <div className="billing-list-head" style={{ marginBottom: 12 }}><div><span>SHIPPING</span><h3>物流 / 運費預設</h3><p className="helper">新增庫存異動時會自動帶入，當次仍可修改。</p></div></div>
          <div className="billing-three-col">
            <div className="field"><label>預設收送貨方式</label><input className="input" list="channel-shipping-methods" value={draft.defaultShippingMethod} onChange={(event) => setDraft({ ...draft, defaultShippingMethod: event.target.value })} placeholder="例如 7-11 店到店" /></div>
            <div className="field"><label>預設運費</label><input className="input" type="number" min="0" step="1" value={draft.defaultShippingFee} onChange={(event) => setDraft({ ...draft, defaultShippingFee: event.target.value })} placeholder="0" /></div>
            <div className="field"><label>預設運費負擔</label><select className="select" value={draft.defaultShippingPayer} onChange={(event) => setDraft({ ...draft, defaultShippingPayer: event.target.value })}><option value="COMPANY">公司負擔</option><option value="CUSTOMER">客戶負擔</option><option value="CHANNEL">通路負擔</option><option value="SUPPLIER">供應商負擔</option></select></div>
          </div>
        </div>

        <div className="header-actions"><button className="btn btn-primary" disabled={loadingId === editing.id}>{loadingId === editing.id ? "儲存中…" : "儲存通路設定"}</button><button type="button" className="btn btn-secondary" onClick={() => { setEditing(null); setDraft(null); }}>取消</button></div>
      </form>
    </section>}
  </>;
}
