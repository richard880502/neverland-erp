"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, RotateCcw, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { MovementBatchEntry } from "@/components/MovementBatchEntry";
import { movementLabels } from "@/lib/inventory";
import type { ChannelType, MovementType } from "@prisma/client";

type Product = { id: string; sku: string; name: string; size: string | null; listPrice: number | null };
type Channel = {
  id: string;
  name: string;
  type: ChannelType;
  defaultShippingMethod: string | null;
  defaultShippingFee: number | null;
  defaultShippingPayer: string | null;
};
type Movement = {
  id: string;
  occurredAt: string;
  type: MovementType;
  quantity: number;
  unitPrice: number | null;
  referenceNo: string | null;
  note: string | null;
  shippingMethod: string | null;
  shippingFee: number | null;
  shippingPayer: string | null;
  shippingGroupKey: string | null;
  product: Product;
  channel: { id: string; name: string; type: ChannelType } | null;
  createdBy: string;
  reversedAt: string | null;
  isReversal: boolean;
};
type ProductSort = "sku" | "name";

const payerLabels: Record<string, string> = { COMPANY: "公司", CUSTOMER: "客戶", CHANNEL: "通路", SUPPLIER: "供應商" };

function productLabel(product: Product) {
  return `${product.sku} · ${product.name}${product.size ? ` · ${product.size}` : ""}`;
}

function ProductPicker({ products, name = "productId", required = true }: { products: Product[]; name?: string; required?: boolean }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [sort, setSort] = useState<ProductSort>("sku");
  const sorted = useMemo(() => [...products].sort((a, b) => sort === "sku"
    ? a.sku.localeCompare(b.sku, "zh-Hant", { numeric: true })
    : a.name.localeCompare(b.name, "zh-Hant") || (a.size ?? "").localeCompare(b.size ?? "", "zh-Hant")), [products, sort]);
  const listId = `product-options-${name}`;

  function choose(value: string) {
    setQuery(value);
    const normalized = value.trim().toLocaleLowerCase();
    const match = products.find((product) => productLabel(product).toLocaleLowerCase() === normalized)
      ?? products.find((product) => product.sku.toLocaleLowerCase() === normalized);
    setSelectedId(match?.id ?? "");
  }

  return <div className="field">
    <label htmlFor={`${name}-search`}>商品 / SKU</label>
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
      <div style={{ position: "relative" }}>
        <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
        <input className="input" id={`${name}-search`} list={listId} value={query} onChange={(event) => choose(event.target.value)} placeholder="輸入 SKU、商品名稱或尺寸" autoComplete="off" style={{ paddingLeft: 32 }} required={required} />
      </div>
      <select className="select" aria-label="商品排序" value={sort} onChange={(event) => setSort(event.target.value as ProductSort)}>
        <option value="sku">編碼順序</option>
        <option value="name">商品名稱</option>
      </select>
    </div>
    <input type="hidden" name={name} value={selectedId} />
    <datalist id={listId}>{sorted.map((product) => <option key={product.id} value={productLabel(product)} />)}</datalist>
    <span className="helper">可直接輸入完整 SKU；候選清單預設依編碼排序。</span>
  </div>;
}

function setFormValue(form: HTMLFormElement, name: string, value: string) {
  const control = form.elements.namedItem(name);
  if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) control.value = value;
}

export function MovementManager({ products, channels, movements, canWrite }: { products: Product[]; channels: Channel[]; movements: Movement[]; canWrite: boolean }) {
  const router = useRouter();
  const [fulfillmentMessage, setFulfillmentMessage] = useState("");
  const [fulfillmentLoading, setFulfillmentLoading] = useState(false);
  const [fulfillmentResetToken, setFulfillmentResetToken] = useState(0);
  const today = new Date().toLocaleDateString("en-CA");
  const consignmentChannels = channels.filter((channel) => channel.type === "CONSIGNMENT");
  const directChannels = channels.filter((channel) => channel.type === "DIRECT");

  async function submitFulfillment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFulfillmentMessage("");
    setFulfillmentLoading(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!form.get("productId")) { setFulfillmentLoading(false); return setFulfillmentMessage("請從搜尋候選中選擇有效商品，或輸入完整 SKU"); }
    const sticky = {
      occurredAt: String(form.get("occurredAt") || today),
      sourceChannelId: String(form.get("sourceChannelId") || ""),
      salesChannelId: String(form.get("salesChannelId") || ""),
      referenceNo: String(form.get("referenceNo") || ""),
    };
    const response = await fetch("/api/movements/consignment-direct-fulfillment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
    const result = await response.json();
    setFulfillmentLoading(false);
    if (!response.ok) return setFulfillmentMessage(result.error ?? "寄賣代發失敗");
    formElement.reset();
    setFormValue(formElement, "occurredAt", sticky.occurredAt);
    setFormValue(formElement, "sourceChannelId", sticky.sourceChannelId);
    setFormValue(formElement, "salesChannelId", sticky.salesChannelId);
    setFormValue(formElement, "referenceNo", sticky.referenceNo);
    setFormValue(formElement, "quantity", "1");
    setFulfillmentResetToken((value) => value + 1);
    setFulfillmentMessage("已記錄；日期、寄賣來源、銷售歸屬與單號已保留，可直接輸入下一筆。");
    router.refresh();
  }

  async function reverse(id: string) {
    if (!confirm("確定要沖銷這筆異動？原始紀錄仍會保留；若同一批物流的所有異動都被沖銷，對應運費支出也會自動作廢。")) return;
    const response = await fetch(`/api/movements/${id}/reverse`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) return alert(result.error ?? "沖銷失敗");
    router.refresh();
  }

  return <>
    <PageHeader eyebrow="Ledger" title="庫存異動" description="新增庫存異動統一使用同一個表格式入口：一列就是單筆，多列可一次寫入；收送貨運費也會依共同設定自動帶入財務。" />

    {canWrite && <MovementBatchEntry products={products} channels={channels} />}

    {canWrite && <details className="panel drawer"><summary><span className="btn btn-primary"><Minus size={16} />寄賣代發</span></summary>
      {fulfillmentMessage && <div className="form-error" style={{ background: "#fff8df", color: "#786b3d", borderColor: "#d3bd69" }}>{fulfillmentMessage}</div>}
      <form className="form-grid" onSubmit={submitFulfillment}>
        <div className="field"><label htmlFor="fulfillment-date">日期</label><input className="input" id="fulfillment-date" name="occurredAt" type="date" defaultValue={today} required /></div>
        <ProductPicker key={`fulfillment-${fulfillmentResetToken}`} products={products} name="productId" />
        <div className="field"><label htmlFor="source-channel">寄賣來源</label><select className="select" id="source-channel" name="sourceChannelId" required><option value="">請選擇寄賣經銷</option>{consignmentChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></div>
        <div className="field"><label htmlFor="sales-channel">銷售歸屬</label><select className="select" id="sales-channel" name="salesChannelId" required><option value="">請選擇直營通路</option>{directChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></div>
        <div className="field"><label htmlFor="fulfillment-quantity">數量</label><input className="input" id="fulfillment-quantity" name="quantity" type="number" min="1" defaultValue="1" required /></div>
        <div className="field"><label htmlFor="fulfillment-price">成交單價</label><input className="input" id="fulfillment-price" name="unitPrice" type="number" min="0" step="1" required /></div>
        <div className="field"><label htmlFor="fulfillment-reference">單號</label><input className="input" id="fulfillment-reference" name="referenceNo" placeholder="選填；連續輸入時會保留" /></div>
        <div className="field"><label htmlFor="fulfillment-note">備註</label><input className="input" id="fulfillment-note" name="note" placeholder="選填；每筆儲存後會清空" /></div>
        <div className="wide"><button className="btn btn-primary" disabled={fulfillmentLoading}>{fulfillmentLoading ? "處理中…" : "記錄寄賣代發"}</button> <span className="helper">系統會在同一個交易內自動建立「寄賣退回」與「直營出貨」；這個特殊流程的運費串接先維持原狀，避免同時對兩筆異動重複入帳。</span></div>
      </form>
    </details>}

    <div className="panel table-panel"><div className="table-wrap"><table>
      <thead><tr><th>日期</th><th>事件</th><th>SKU</th><th>商品</th><th>通路</th><th className="number">數量</th><th className="number">成交／參考單價</th><th>物流 / 運費</th><th>單號／備註</th><th>建立者</th><th></th></tr></thead>
      <tbody>{movements.map((m) => <tr key={m.id} style={{ opacity: m.reversedAt ? .5 : 1 }}>
        <td>{new Date(m.occurredAt).toLocaleDateString("zh-TW")}</td><td><span className={`badge ${m.isReversal ? "warn" : ""}`}>{m.isReversal ? "沖銷 · " : ""}{movementLabels[m.type]}</span></td>
        <td className="sku">{m.product.sku}</td><td>{m.product.name} {m.product.size ?? ""}</td><td>{m.channel?.name ?? (m.type === "RECEIVE" ? "倉庫" : "未指定")}</td>
        <td className="number"><strong>{m.quantity}</strong></td><td className="number">{m.unitPrice != null
          ? `NT$ ${m.unitPrice.toLocaleString()}`
          : m.product.listPrice != null
            ? <><span>NT$ {m.product.listPrice.toLocaleString()}</span><small className="price-kind">參考定價</small></>
            : "—"}</td>
        <td>{m.shippingMethod || m.shippingFee != null ? <div style={{ display: "grid", gap: 3 }}><strong>{m.shippingMethod ?? "物流"}{m.shippingFee != null ? ` · NT$ ${m.shippingFee.toLocaleString()}` : ""}</strong><small className="price-kind">{m.shippingPayer ? `${payerLabels[m.shippingPayer] ?? m.shippingPayer}負擔` : "未指定負擔者"}{m.shippingPayer === "COMPANY" && (m.shippingFee ?? 0) > 0 ? " · 已同步財務" : ""}</small></div> : "—"}</td>
        <td>{[m.referenceNo, m.note].filter(Boolean).join(" · ") || "—"}</td><td>{m.createdBy}</td>
        <td>{canWrite && !m.reversedAt && !m.isReversal && <button className="btn btn-danger" onClick={() => reverse(m.id)} title="沖銷"><RotateCcw size={15} /></button>}</td>
      </tr>)}</tbody>
    </table></div></div>
  </>;
}
