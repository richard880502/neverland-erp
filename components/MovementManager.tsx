"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { channelTypeLabels, movementLabels } from "@/lib/inventory";
import type { ChannelType, MovementType } from "@prisma/client";

type Product = { id: string; sku: string; name: string; size: string | null; listPrice: number | null };
type Channel = { id: string; name: string; type: ChannelType };
type Movement = { id: string; occurredAt: string; type: MovementType; quantity: number; unitPrice: number | null; referenceNo: string | null; note: string | null; product: Product; channel: Channel | null; createdBy: string; reversedAt: string | null; isReversal: boolean };

export function MovementManager({ products, channels, movements, canWrite }: { products: Product[]; channels: Channel[]; movements: Movement[]; canWrite: boolean }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [loading, setLoading] = useState(false);
  const today = new Date().toLocaleDateString("en-CA");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setLoading(true); const formElement = event.currentTarget; const form = new FormData(formElement);
    const response = await fetch("/api/movements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
    const result = await response.json(); setLoading(false);
    if (!response.ok) return setMessage(result.error ?? "新增異動失敗");
    formElement.reset(); router.refresh();
  }
  async function reverse(id: string) {
    if (!confirm("確定要沖銷這筆異動？原始紀錄仍會保留。")) return;
    const response = await fetch(`/api/movements/${id}/reverse`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) return alert(result.error ?? "沖銷失敗");
    router.refresh();
  }
  return <>
    <PageHeader eyebrow="Ledger" title="庫存異動" description="每次實物流動新增一筆；錯誤資料以沖銷處理。" />
    {canWrite && <details className="panel drawer" open><summary><span className="btn btn-primary"><Plus size={16} />新增異動</span></summary>
      {message && <div className="form-error">{message}</div>}
      <form className="form-grid" onSubmit={submit}>
        <div className="field"><label htmlFor="movement-date">日期</label><input className="input" id="movement-date" name="occurredAt" type="date" defaultValue={today} required /></div>
        <div className="field"><label htmlFor="movement-type">事件</label><select className="select" id="movement-type" name="type" defaultValue="RECEIVE">{Object.entries(movementLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
        <div className="field"><label htmlFor="movement-product">商品 / SKU</label><select className="select" id="movement-product" name="productId" required><option value="">請選擇</option>{products.map((p) => <option value={p.id} key={p.id}>{p.sku} · {p.name} {p.size ?? ""}</option>)}</select></div>
        <div className="field"><label htmlFor="movement-channel">通路（進貨可不選）</label><select className="select" id="movement-channel" name="channelId"><option value="">不指定</option>{channels.map((c) => <option value={c.id} key={c.id}>{c.name} · {channelTypeLabels[c.type]}</option>)}</select></div>
        <div className="field"><label htmlFor="movement-quantity">數量</label><input className="input" id="movement-quantity" name="quantity" type="number" min="1" defaultValue="1" required /></div>
        <div className="field"><label htmlFor="movement-price">銷售單價（銷售事件）</label><input className="input" id="movement-price" name="unitPrice" type="number" min="0" step="1" /></div>
        <div className="field"><label htmlFor="movement-reference">單號</label><input className="input" id="movement-reference" name="referenceNo" placeholder="選填" /></div>
        <div className="field"><label htmlFor="movement-note">備註</label><input className="input" id="movement-note" name="note" placeholder="選填" /></div>
        <div className="wide"><button className="btn btn-primary" disabled={loading}>{loading ? "記錄中…" : "記錄異動"}</button> <span className="helper">系統會在寫入前檢查倉庫與寄賣通路的可用庫存。</span></div>
      </form>
    </details>}
    <div className="panel table-panel"><div className="table-wrap"><table>
      <thead><tr><th>日期</th><th>事件</th><th>SKU</th><th>商品</th><th>通路</th><th className="number">數量</th><th className="number">成交／參考單價</th><th>單號／備註</th><th>建立者</th><th></th></tr></thead>
      <tbody>{movements.map((m) => <tr key={m.id} style={{ opacity: m.reversedAt ? .5 : 1 }}>
        <td>{new Date(m.occurredAt).toLocaleDateString("zh-TW")}</td><td><span className={`badge ${m.isReversal ? "warn" : ""}`}>{m.isReversal ? "沖銷 · " : ""}{movementLabels[m.type]}</span></td>
        <td className="sku">{m.product.sku}</td><td>{m.product.name} {m.product.size ?? ""}</td><td>{m.channel?.name ?? (m.type === "RECEIVE" ? "倉庫" : "未指定")}</td>
        <td className="number"><strong>{m.quantity}</strong></td><td className="number">{m.unitPrice != null
          ? `NT$ ${m.unitPrice.toLocaleString()}`
          : m.product.listPrice != null
            ? <><span>NT$ {m.product.listPrice.toLocaleString()}</span><small className="price-kind">參考定價</small></>
            : "—"}</td><td>{m.referenceNo ?? m.note ?? "—"}</td><td>{m.createdBy}</td>
        <td>{canWrite && !m.reversedAt && !m.isReversal && <button className="btn btn-danger" onClick={() => reverse(m.id)} title="沖銷"><RotateCcw size={15} /></button>}</td>
      </tr>)}</tbody>
    </table></div></div>
  </>;
}
