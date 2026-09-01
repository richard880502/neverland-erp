"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Power, PowerOff, Plus, Settings2, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { channelTypeLabels } from "@/lib/inventory";

type SettlementCycle = "MONTHLY" | "PER_SHIPMENT" | "MANUAL";
type BillingTrigger = "EXTERNAL_STATEMENT" | "DELIVERED" | "SHIPPED" | "MANUAL";

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
  settlementCycle: SettlementCycle | null;
  billingTrigger: BillingTrigger | null;
  billingWithinDays: number | null;
  includeShippingInBilling: boolean;
  requiresSalesInvoice: boolean;
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
  settlementCycle: string;
  billingTrigger: string;
  billingWithinDays: string;
  includeShippingInBilling: boolean;
  requiresSalesInvoice: boolean;
  defaultShippingMethod: string;
  defaultShippingFee: string;
  defaultShippingPayer: string;
};

const shippingMethods = ["7-11 店到店", "全家店到店", "郵局", "黑貓宅急便", "新竹物流", "Lalamove", "親送", "店取", "其他"];
const payerLabels: Record<string, string> = { COMPANY: "公司負擔", CUSTOMER: "客戶負擔", CHANNEL: "通路負擔", SUPPLIER: "供應商負擔" };
const cycleLabels: Record<SettlementCycle, string> = { MONTHLY: "每月結算", PER_SHIPMENT: "每次出貨結算", MANUAL: "手動結算" };
const triggerLabels: Record<BillingTrigger, string> = { EXTERNAL_STATEMENT: "收到通路月結表", DELIVERED: "商品到貨", SHIPPED: "出貨完成", MANUAL: "手動觸發" };

function supportsBilling(channel: Channel) {
  return channel.type === "CONSIGNMENT" || channel.type === "BUYOUT";
}

function defaultCycle(channel: Channel) {
  if (channel.settlementCycle) return channel.settlementCycle;
  return channel.type === "BUYOUT" ? "PER_SHIPMENT" : "MONTHLY";
}

function defaultTrigger(channel: Channel) {
  if (channel.billingTrigger) return channel.billingTrigger;
  return channel.type === "BUYOUT" ? "DELIVERED" : "EXTERNAL_STATEMENT";
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
    settlementCycle: defaultCycle(channel),
    billingTrigger: defaultTrigger(channel),
    billingWithinDays: channel.billingWithinDays == null ? (channel.type === "BUYOUT" ? "7" : "") : String(channel.billingWithinDays),
    includeShippingInBilling: channel.includeShippingInBilling,
    requiresSalesInvoice: channel.requiresSalesInvoice,
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

function settlementSummary(channel: Channel) {
  if (!supportsBilling(channel)) return null;
  const cycle = channel.settlementCycle ? cycleLabels[channel.settlementCycle] : "結算規則未設定";
  const trigger = channel.billingTrigger ? triggerLabels[channel.billingTrigger] : null;
  const billingDays = channel.billingWithinDays == null ? null : `${channel.billingWithinDays} 天內請款`;
  const shipping = channel.includeShippingInBilling ? "運費列入請款" : null;
  const invoice = channel.requiresSalesInvoice ? "需開發票" : null;
  return [cycle, trigger, billingDays, shipping, invoice].filter(Boolean).join(" · ");
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
    if (editing?.id === channel.id) {
      setEditing(null);
      setDraft(null);
      return;
    }
    setEditing(channel);
    setDraft(toDraft(channel));
    setMessage("");
  }

  function closeSettings() {
    setEditing(null);
    setDraft(null);
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
        settlementCycle: nullable(draft.settlementCycle),
        billingTrigger: nullable(draft.billingTrigger),
        billingWithinDays: draft.billingWithinDays === "" ? null : Number(draft.billingWithinDays),
        includeShippingInBilling: draft.includeShippingInBilling,
        requiresSalesInvoice: draft.requiresSalesInvoice,
      });
    }
    const response = await fetch(`/api/channels/${editing.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json(); setLoadingId("");
    if (!response.ok) return setMessage(result.error ?? "通路設定儲存失敗");
    closeSettings();
    router.refresh();
  }

  return <>
    <PageHeader eyebrow="Master data" title="通路主檔" description="直接在列表展開設定；商務條件、結算請款規則與物流預設集中管理。" />
    {message && <div className="form-error">{message}</div>}
    {canWrite && <details className="panel drawer"><summary><span className="btn btn-primary"><Plus size={16} />新增通路</span></summary>
      <form className="inline-form" onSubmit={submit}>
        <div className="field"><label>通路名稱</label><input className="input" name="name" required /></div>
        <div className="field"><label>通路類型</label><select className="select" name="type" defaultValue="CONSIGNMENT">{Object.entries(channelTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
        <button className="btn btn-primary" disabled={loading}>{loading ? "儲存中…" : "建立通路"}</button>
      </form>
    </details>}
    {canWrite && <p className="master-note">已有庫存異動或請款單的通路不可永久刪除，請改用停用以保留帳務歷史。</p>}

    <datalist id="channel-shipping-methods">{shippingMethods.map((name) => <option value={name} key={name} />)}</datalist>
    <div className="panel table-panel"><div className="table-wrap"><table>
      <thead><tr><th>通路名稱</th><th>類型</th><th>設定摘要</th><th>狀態</th>{canWrite && <th>操作</th>}</tr></thead>
      <tbody>{channels.map((channel) => {
        const expanded = editing?.id === channel.id && draft;
        return <Fragment key={channel.id}>
          <tr className={channel.active ? undefined : "inactive-row"}>
            <td><strong>{channel.name}</strong></td>
            <td><span className="badge">{channelTypeLabels[channel.type]}</span></td>
            <td><div className="channel-billing-summary">
              {supportsBilling(channel) && <span>{channel.settlementRate == null ? "結算比例未設定" : `結算 ${channel.settlementRate * 100}%`} · 稅 {channel.taxRate == null ? "未設定" : `${channel.taxRate * 100}%`} · 付款 {channel.paymentTermsDays ?? 0} 天</span>}
              {settlementSummary(channel) && <span>{settlementSummary(channel)}</span>}
              <span>{shippingSummary(channel)}</span>
            </div></td>
            <td><span className={`badge ${channel.active ? "green" : ""}`}>{channel.active ? "啟用" : "停用"}</span></td>
            {canWrite && <td><div className="row-actions">
              <button className="btn btn-secondary icon-btn" onClick={() => editSettings(channel)} title={expanded ? "收起通路設定" : "展開通路設定"} aria-label={`${expanded ? "收起" : "展開"} ${channel.name} 通路設定`} aria-expanded={Boolean(expanded)}><Settings2 size={15} /></button>
              <button className="btn btn-secondary icon-btn" disabled={loadingId === channel.id} onClick={() => toggleChannel(channel)} title={channel.active ? "停用通路" : "啟用通路"} aria-label={`${channel.active ? "停用" : "啟用"} ${channel.name}`}>{channel.active ? <PowerOff size={15} /> : <Power size={15} />}</button>
              <button className="btn btn-danger icon-btn" disabled={loadingId === channel.id || channel.movementCount > 0 || channel.billingCount > 0} onClick={() => deleteChannel(channel)} title={channel.movementCount > 0 || channel.billingCount > 0 ? "已有關聯帳務，請改用停用" : "永久刪除通路"} aria-label={`刪除 ${channel.name}`}><Trash2 size={15} /></button>
            </div></td>}
          </tr>

          {expanded && <tr>
            <td colSpan={canWrite ? 5 : 4} style={{ padding: 0, background: "var(--surface-subtle)" }}>
              <div style={{ padding: 20, borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
                <div className="billing-list-head" style={{ marginBottom: 16 }}>
                  <div><span>CHANNEL SETTINGS</span><h2>{editing.name} · 通路設定</h2><p className="helper">修改完成後直接儲存；打開其他通路時這一列會自動收起。</p></div>
                </div>
                <form onSubmit={saveSettings}>
                  <div style={{ marginBottom: 22 }}>
                    <div className="billing-list-head" style={{ marginBottom: 12 }}><div><span>CHANNEL</span><h3>通路資訊</h3></div></div>
                    <div className="billing-two-col">
                      <div className="field"><label>通路名稱</label><div className="input" style={{ display: "flex", alignItems: "center", background: "var(--surface)" }}>{editing.name}</div></div>
                      <div className="field"><label>通路類型</label><div className="input" style={{ display: "flex", alignItems: "center", background: "var(--surface)" }}>{channelTypeLabels[editing.type]}</div></div>
                    </div>
                  </div>

                  {supportsBilling(editing) && <>
                    <div style={{ marginBottom: 22 }}>
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
                    </div>

                    <div style={{ marginBottom: 22 }}>
                      <div className="billing-list-head" style={{ marginBottom: 12 }}><div><span>SETTLEMENT POLICY</span><h3>結算 / 請款規則</h3><p className="helper">這裡定義平常怎麼結算；實際建立結算時由系統直接讀取，不需要每次重新設定。</p></div></div>
                      <div className="billing-three-col">
                        <div className="field"><label>結算方式</label><select className="select" value={draft.settlementCycle} onChange={(event) => setDraft({ ...draft, settlementCycle: event.target.value })}><option value="MONTHLY">每月結算</option><option value="PER_SHIPMENT">每次出貨結算</option><option value="MANUAL">手動結算</option></select></div>
                        <div className="field"><label>請款觸發</label><select className="select" value={draft.billingTrigger} onChange={(event) => setDraft({ ...draft, billingTrigger: event.target.value })}><option value="EXTERNAL_STATEMENT">收到通路月結表</option><option value="DELIVERED">商品到貨</option><option value="SHIPPED">出貨完成</option><option value="MANUAL">手動觸發</option></select></div>
                        <div className="field"><label>觸發後幾天內請款</label><input className="input" type="number" min="0" max="365" placeholder="例如 7" value={draft.billingWithinDays} onChange={(event) => setDraft({ ...draft, billingWithinDays: event.target.value })} /></div>
                        <div className="field"><label>運費列入請款</label><select className="select" value={draft.includeShippingInBilling ? "YES" : "NO"} onChange={(event) => setDraft({ ...draft, includeShippingInBilling: event.target.value === "YES" })}><option value="NO">否，我方吸收 / 不列入</option><option value="YES">是，結算時加總運費</option></select></div>
                        <div className="field"><label>銷項發票</label><select className="select" value={draft.requiresSalesInvoice ? "YES" : "NO"} onChange={(event) => setDraft({ ...draft, requiresSalesInvoice: event.target.value === "YES" })}><option value="NO">不固定要求</option><option value="YES">需要開發票</option></select></div>
                      </div>
                      <p className="helper">「付款天數」是開出請款後對方多久付款；「幾天內請款」是觸發事件發生後，我們多久內要完成請款，兩者分開管理。</p>
                    </div>
                  </>}

                  <div style={{ marginBottom: 22 }}>
                    <div className="billing-list-head" style={{ marginBottom: 12 }}><div><span>SHIPPING</span><h3>物流 / 運費預設</h3><p className="helper">新增庫存異動時會自動帶入，當次仍可修改；例如 SIMON 台中店親送就只改那一次。</p></div></div>
                    <div className="billing-three-col">
                      <div className="field"><label>預設收送貨方式</label><input className="input" list="channel-shipping-methods" value={draft.defaultShippingMethod} onChange={(event) => setDraft({ ...draft, defaultShippingMethod: event.target.value })} placeholder="例如 7-11 店到店" /></div>
                      <div className="field"><label>預設運費</label><input className="input" type="number" min="0" step="1" value={draft.defaultShippingFee} onChange={(event) => setDraft({ ...draft, defaultShippingFee: event.target.value })} placeholder="0" /></div>
                      <div className="field"><label>預設運費負擔</label><select className="select" value={draft.defaultShippingPayer} onChange={(event) => setDraft({ ...draft, defaultShippingPayer: event.target.value })}><option value="COMPANY">公司負擔</option><option value="CUSTOMER">客戶負擔</option><option value="CHANNEL">通路負擔</option><option value="SUPPLIER">供應商負擔</option></select></div>
                    </div>
                  </div>

                  <div className="header-actions"><button className="btn btn-primary" disabled={loadingId === editing.id}>{loadingId === editing.id ? "儲存中…" : "儲存通路設定"}</button><button type="button" className="btn btn-secondary" onClick={closeSettings}>取消</button></div>
                </form>
              </div>
            </td>
          </tr>}
        </Fragment>;
      })}</tbody>
    </table></div></div>
  </>;
}
