"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";

const payerLabels: Record<string, string> = {
  COMPANY: "公司負擔",
  CUSTOMER: "客戶負擔",
  CHANNEL: "通路負擔",
  SUPPLIER: "供應商負擔",
};

const shippingMethods = ["7-11 店到店", "全家店到店", "郵局", "黑貓宅急便", "新竹物流", "Lalamove", "親送", "店取", "其他"];

type ChannelShipping = {
  id: string;
  name: string;
  active: boolean;
  defaultShippingMethod: string | null;
  defaultShippingFee: number | null;
  defaultShippingPayer: string | null;
};

export function ChannelShippingDefaults({ channels, canWrite }: { channels: ChannelShipping[]; canWrite: boolean }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState("");
  const [method, setMethod] = useState("");
  const [fee, setFee] = useState("");
  const [payer, setPayer] = useState("COMPANY");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function edit(channel: ChannelShipping) {
    setEditingId(channel.id);
    setMethod(channel.defaultShippingMethod ?? "");
    setFee(channel.defaultShippingFee == null ? "" : String(channel.defaultShippingFee));
    setPayer(channel.defaultShippingPayer ?? "COMPANY");
    setMessage("");
  }

  async function save() {
    if (!editingId) return;
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/channels/${editingId}/shipping`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        defaultShippingMethod: method.trim() || null,
        defaultShippingFee: fee === "" ? null : Number(fee),
        defaultShippingPayer: payer || null,
      }),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setMessage(result.error ?? "物流預設儲存失敗");
    setEditingId("");
    setMessage("物流預設已儲存");
    router.refresh();
  }

  return <section className="panel" style={{ marginTop: 18 }}>
    <datalist id="channel-shipping-methods">{shippingMethods.map((name) => <option value={name} key={name} />)}</datalist>
    <div className="billing-list-head">
      <div><span>SHIPPING DEFAULTS</span><h2>物流 / 運費預設</h2><p className="helper">庫存異動留空時自動套用；當次輸入仍可覆寫，不會修改這裡的預設值。</p></div>
      <Truck size={18} />
    </div>
    {message && <div className="form-error">{message}</div>}
    <div className="table-wrap"><table>
      <thead><tr><th>通路</th><th>預設收送方式</th><th className="number">預設運費</th><th>預設負擔者</th>{canWrite && <th>操作</th>}</tr></thead>
      <tbody>{channels.map((channel) => {
        const editing = editingId === channel.id;
        return <tr key={channel.id} className={channel.active ? undefined : "inactive-row"}>
          <td><strong>{channel.name}</strong></td>
          <td>{editing ? <input className="input" list="channel-shipping-methods" value={method} onChange={(event) => setMethod(event.target.value)} placeholder="例如 7-11 店到店" /> : channel.defaultShippingMethod ?? <span className="muted">未設定</span>}</td>
          <td className="number">{editing ? <input className="input" type="number" min="0" step="1" value={fee} onChange={(event) => setFee(event.target.value)} placeholder="0" /> : channel.defaultShippingFee == null ? <span className="muted">—</span> : `$${channel.defaultShippingFee.toLocaleString("zh-TW")}`}</td>
          <td>{editing ? <select className="select" value={payer} onChange={(event) => setPayer(event.target.value)}><option value="COMPANY">公司負擔</option><option value="CUSTOMER">客戶負擔</option><option value="CHANNEL">通路負擔</option><option value="SUPPLIER">供應商負擔</option></select> : channel.defaultShippingPayer ? payerLabels[channel.defaultShippingPayer] ?? channel.defaultShippingPayer : <span className="muted">未設定</span>}</td>
          {canWrite && <td>{editing ? <div className="row-actions"><button className="btn btn-primary" type="button" disabled={saving} onClick={() => void save()}>{saving ? "儲存中…" : "儲存"}</button><button className="btn btn-secondary" type="button" disabled={saving} onClick={() => setEditingId("")}>取消</button></div> : <button className="btn btn-secondary" type="button" onClick={() => edit(channel)}>設定</button>}</td>}
        </tr>;
      })}</tbody>
    </table></div>
  </section>;
}
