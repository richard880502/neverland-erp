"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Power, PowerOff, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";

type Product = { id: string; sku: string; name: string; size: string | null; safetyStock: number; listPrice: number | null; wholesalePrice: number | null; unitCost: number | null; description: string | null; imageThumbPath: string | null; active: boolean; movementCount: number };

export function ProductManager({ products, canWrite }: { products: Product[]; canWrite: boolean }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [loading, setLoading] = useState(false); const [loadingId, setLoadingId] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setMessage(""); const formElement = event.currentTarget; const form = new FormData(formElement);
    const response = await fetch("/api/products", { method: "POST", body: form });
    const result = await response.json(); setLoading(false);
    if (!response.ok) return setMessage(result.error ?? "新增失敗");
    formElement.reset(); router.refresh();
  }
  async function toggleProduct(product: Product) {
    setLoadingId(product.id); setMessage("");
    const response = await fetch(`/api/products/${product.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !product.active }) });
    const result = await response.json(); setLoadingId("");
    if (!response.ok) return setMessage(result.error ?? "狀態更新失敗");
    router.refresh();
  }
  async function deleteProduct(product: Product) {
    if (!confirm(`確定永久刪除商品 ${product.sku}？此操作無法復原。`)) return;
    setLoadingId(product.id); setMessage("");
    const response = await fetch(`/api/products/${product.id}`, { method: "DELETE" });
    const result = await response.json(); setLoadingId("");
    if (!response.ok) return setMessage(result.error ?? "刪除失敗");
    router.refresh();
  }
  return <>
    <PageHeader eyebrow="Master data" title="商品主檔" description="每個尺寸使用獨立 SKU，確保庫存可以準確追蹤。" />
    {message && <div className="form-error">{message}</div>}
    {canWrite && <details className="panel drawer"><summary><span className="btn btn-primary"><Plus size={16} />新增商品</span></summary>
      <form className="form-grid" onSubmit={submit}>
        <div className="field"><label htmlFor="product-sku">SKU</label><input className="input" id="product-sku" name="sku" required /></div>
        <div className="field"><label htmlFor="product-name">商品名稱</label><input className="input" id="product-name" name="name" required /></div>
        <div className="field"><label htmlFor="product-size">尺寸</label><input className="input" id="product-size" name="size" placeholder="M / L / F" /></div>
        <div className="field"><label htmlFor="product-safety">安全庫存</label><input className="input" id="product-safety" name="safetyStock" type="number" min="0" defaultValue="0" required /></div>
        <div className="field"><label htmlFor="product-list-price">定價</label><input className="input" id="product-list-price" name="listPrice" type="number" min="0" step="0.01" /></div>
        <div className="field"><label htmlFor="product-wholesale-price">經銷價</label><input className="input" id="product-wholesale-price" name="wholesalePrice" type="number" min="0" step="0.01" /></div>
        <div className="field"><label htmlFor="product-cost">單位成本</label><input className="input" id="product-cost" name="unitCost" type="number" min="0" step="0.01" /></div>
        <div className="field"><label htmlFor="product-image">商品圖片（選填）</label><input className="input file-input" id="product-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" /><span className="helper">JPEG、PNG 或 WebP，最大 8 MB；未選擇可留白。</span></div>
        <div className="field wide"><label htmlFor="product-description">商品文案</label><textarea className="textarea" id="product-description" name="description" rows={4} /></div>
        <div className="wide"><button className="btn btn-primary" disabled={loading}>{loading ? "上傳並儲存中…" : "建立商品"}</button></div>
      </form>
    </details>}
    {canWrite && <p className="master-note">已有庫存異動的商品不可永久刪除，請改用停用以保留帳務歷史。</p>}
    <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>圖片</th><th>SKU</th><th>商品名稱</th><th>尺寸</th><th className="number">安全庫存</th><th className="number">定價</th><th className="number">經銷價</th><th className="number">單位成本</th><th>狀態</th>{canWrite && <th>操作</th>}</tr></thead>
      <tbody>{products.map((p) => <tr key={p.id} className={p.active ? undefined : "inactive-row"}><td>{p.imageThumbPath ? <img className="product-thumb" src={`/api/uploads/${p.imageThumbPath}`} alt={`${p.name} 商品圖`} /> : <span className="product-thumb empty-thumb">無圖</span>}</td><td className="sku">{p.sku}</td><td title={p.description ?? undefined}>{p.name}</td><td>{p.size ?? "—"}</td><td className="number">{p.safetyStock}</td><td className="number">{p.listPrice == null ? "—" : `NT$ ${p.listPrice.toLocaleString()}`}</td><td className="number">{p.wholesalePrice == null ? "—" : `NT$ ${p.wholesalePrice.toLocaleString()}`}</td><td className="number">{p.unitCost == null ? "—" : `NT$ ${p.unitCost.toLocaleString()}`}</td><td><span className={`badge ${p.active ? "green" : ""}`}>{p.active ? "啟用" : "停用"}</span></td>{canWrite && <td><div className="row-actions"><button className="btn btn-secondary icon-btn" disabled={loadingId === p.id} onClick={() => toggleProduct(p)} title={p.active ? "停用商品" : "啟用商品"} aria-label={`${p.active ? "停用" : "啟用"} ${p.sku}`}>{p.active ? <PowerOff size={15} /> : <Power size={15} />}</button><button className="btn btn-danger icon-btn" disabled={loadingId === p.id || p.movementCount > 0} onClick={() => deleteProduct(p)} title={p.movementCount > 0 ? `已有 ${p.movementCount} 筆異動，請改用停用` : "永久刪除商品"} aria-label={`刪除 ${p.sku}`}><Trash2 size={15} /></button></div></td>}</tr>)}</tbody>
    </table></div></div>
  </>;
}
