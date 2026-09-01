"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Minus, RotateCcw, Search, X } from "lucide-react";
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
type MovementFilters = {
  q: string;
  type: string;
  channel: string;
  start: string;
  end: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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

export function MovementManager({ products, channels, movements, filters, canWrite }: { products: Product[]; channels: Channel[]; movements: Movement[]; filters: MovementFilters; canWrite: boolean }) {
  const router = useRouter();
  const [fulfillmentMessage, setFulfillmentMessage] = useState("");
  const [fulfillmentLoading, setFulfillmentLoading] = useState(false);
  const [fulfillmentResetToken, setFulfillmentResetToken] = useState(0);
  const today = new Date().toLocaleDateString("en-CA");
  const consignmentChannels = channels.filter((channel) => channel.type === "CONSIGNMENT");
  const directChannels = channels.filter((channel) => channel.type === "DIRECT");
  const filterKey = [filters.q, filters.type, filters.channel, filters.start, filters.end].join("|");
  const firstResult = filters.total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const lastResult = Math.min(filters.page * filters.pageSize, filters.total);

  function currentSearchParams(nextPage?: number) {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.type) params.set("type", filters.type);
    if (filters.channel) params.set("channel", filters.channel);
    if (filters.start) params.set("start", filters.start);
    if (filters.end) params.set("end", filters.end);
    if (nextPage && nextPage > 1) params.set("page", String(nextPage));
    return params;
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const key of ["q", "type", "channel", "start", "end"]) {
      const value = String(form.get(key) ?? "").trim();
      if (value) params.set(key, value);
    }
    router.push(params.size ? `/movements?${params.toString()}` : "/movements");
  }

  function goToPage(page: number) {
    const params = currentSearchParams(page);
    router.push(params.size ? `/movements?${params.toString()}` : "/movements");
  }

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
    <PageHeader eyebrow="Ledger" title="庫存異動" description="新增庫存異動統一使用同一個表格式入口：一列就是單筆，多列可一次寫入；歷史異動可依商品、事件、通路與日期直接查詢。" />

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

    <div className="panel" style={{ padding: 18 }}>
      <form key={filterKey} onSubmit={submitSearch} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field" style={{ flex: "2 1 300px", marginBottom: 0 }}><label htmlFor="movement-query">搜尋異動</label><div style={{ position: "relative" }}><Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} /><input className="input" id="movement-query" name="q" defaultValue={filters.q} placeholder="SKU、商品、尺寸、單號、備註、物流方式、建立者" style={{ width: "100%", paddingLeft: 34 }} /></div></div>
        <div className="field" style={{ flex: "1 1 155px", marginBottom: 0 }}><label htmlFor="movement-filter-type">事件</label><select className="select" id="movement-filter-type" name="type" defaultValue={filters.type}><option value="">全部事件</option>{Object.entries(movementLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
        <div className="field" style={{ flex: "1 1 180px", marginBottom: 0 }}><label htmlFor="movement-filter-channel">通路</label><select className="select" id="movement-filter-channel" name="channel" defaultValue={filters.channel}><option value="">全部通路</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></div>
        <div className="field" style={{ flex: "1 1 145px", marginBottom: 0 }}><label htmlFor="movement-filter-start">開始日期</label><input className="input" id="movement-filter-start" name="start" type="date" defaultValue={filters.start} /></div>
        <div className="field" style={{ flex: "1 1 145px", marginBottom: 0 }}><label htmlFor="movement-filter-end">結束日期</label><input className="input" id="movement-filter-end" name="end" type="date" defaultValue={filters.end} /></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}><button className="btn btn-primary" type="submit"><Search size={15} />搜尋</button><button className="btn btn-secondary" type="button" onClick={() => router.push("/movements")}><X size={15} />清除</button></div>
      </form>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
        <span className="helper">共 {filters.total.toLocaleString()} 筆；目前顯示第 {firstResult.toLocaleString()}–{lastResult.toLocaleString()} 筆。搜尋會直接查完整庫存異動紀錄，不受最新 100 筆限制。</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}><button className="btn btn-secondary icon-btn" type="button" disabled={filters.page <= 1} onClick={() => goToPage(filters.page - 1)} title="上一頁"><ChevronLeft size={15} /></button><span className="helper">第 {filters.page} / {filters.totalPages} 頁</span><button className="btn btn-secondary icon-btn" type="button" disabled={filters.page >= filters.totalPages} onClick={() => goToPage(filters.page + 1)} title="下一頁"><ChevronRight size={15} /></button></div>
      </div>
    </div>

    <div className="panel table-panel"><div className="table-wrap"><table>
      <thead><tr><th>日期</th><th>事件</th><th>SKU</th><th>商品</th><th>通路</th><th className="number">數量</th><th className="number">成交／參考單價</th><th>物流 / 運費</th><th>單號／備註</th><th>建立者</th><th></th></tr></thead>
      <tbody>{movements.length ? movements.map((movement) => <tr key={movement.id} style={{ opacity: movement.reversedAt ? .5 : 1 }}>
        <td>{new Date(movement.occurredAt).toLocaleDateString("zh-TW")}</td><td><span className={`badge ${movement.isReversal ? "warn" : ""}`}>{movement.isReversal ? "沖銷 · " : ""}{movementLabels[movement.type]}</span></td>
        <td className="sku">{movement.product.sku}</td><td>{movement.product.name} {movement.product.size ?? ""}</td><td>{movement.channel?.name ?? (movement.type === "RECEIVE" ? "倉庫" : "未指定")}</td>
        <td className="number"><strong>{movement.quantity}</strong></td><td className="number">{movement.unitPrice != null
          ? `NT$ ${movement.unitPrice.toLocaleString()}`
          : movement.product.listPrice != null
            ? <><span>NT$ {movement.product.listPrice.toLocaleString()}</span><small className="price-kind">參考定價</small></>
            : "—"}</td>
        <td>{movement.shippingMethod || movement.shippingFee != null ? <div style={{ display: "grid", gap: 3 }}><strong>{movement.shippingMethod ?? "物流"}{movement.shippingFee != null ? ` · NT$ ${movement.shippingFee.toLocaleString()}` : ""}</strong><small className="price-kind">{movement.shippingPayer ? `${payerLabels[movement.shippingPayer] ?? movement.shippingPayer}負擔` : "未指定負擔者"}{movement.shippingPayer === "COMPANY" && (movement.shippingFee ?? 0) > 0 ? " · 已同步財務" : ""}</small></div> : "—"}</td>
        <td>{[movement.referenceNo, movement.note].filter(Boolean).join(" · ") || "—"}</td><td>{movement.createdBy}</td>
        <td>{canWrite && !movement.reversedAt && !movement.isReversal && <button className="btn btn-danger" onClick={() => reverse(movement.id)} title="沖銷"><RotateCcw size={15} /></button>}</td>
      </tr>) : <tr><td colSpan={11} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>沒有符合目前條件的庫存異動。</td></tr>}</tbody>
    </table></div></div>
  </>;
}
