"use client";
/* eslint-disable @next/next/no-img-element */

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Pencil, Power, PowerOff, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";

type Product = { id: string; sku: string; name: string; size: string | null; safetyStock: number; listPrice: number | null; wholesalePrice: number | null; unitCost: number | null; description: string | null; imageThumbPath: string | null; active: boolean; movementCount: number };

const SIZE_OPTIONS = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "F"];

function parseCustomSizes(value: string) {
  return value.split(/[\n,，]+/).map((item) => item.trim()).filter(Boolean);
}

function uniqueSizes(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleUpperCase("en-US");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function skuForSize(base: string, size: string) {
  const normalizedBase = base.trim().replace(/-+$/, "");
  return size ? `${normalizedBase}-${size}` : normalizedBase;
}

export function ProductManager({ products, canWrite, canEditPricing }: { products: Product[]; canWrite: boolean; canEditPricing: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [imageEditingId, setImageEditingId] = useState("");
  const [skuBase, setSkuBase] = useState("");
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [customSizes, setCustomSizes] = useState("");
  const [includeNoSize, setIncludeNoSize] = useState(false);

  const variantSizes = useMemo(() => uniqueSizes([
    ...selectedSizes,
    ...parseCustomSizes(customSizes),
    ...(includeNoSize ? [""] : []),
  ]), [customSizes, includeNoSize, selectedSizes]);

  const previewSkus = useMemo(() => {
    if (!skuBase.trim()) return [];
    return variantSizes.map((size) => skuForSize(skuBase, size));
  }, [skuBase, variantSizes]);

  function toggleSize(size: string) {
    setSelectedSizes((current) => current.includes(size) ? current.filter((item) => item !== size) : [...current, size]);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!skuBase.trim()) return setMessage("請輸入 SKU 基底");
    if (!variantSizes.length) return setMessage("請至少勾選一個尺寸，或選擇「無尺寸」");

    setLoading(true);
    setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.set("skuBase", skuBase.trim().replace(/-+$/, ""));
    form.set("sizes", JSON.stringify(variantSizes));

    try {
      const response = await fetch("/api/products", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) return setMessage(result.error ?? "新增失敗");
      formElement.reset();
      setSkuBase("");
      setSelectedSizes([]);
      setCustomSizes("");
      setIncludeNoSize(false);
      router.refresh();
    } catch {
      setMessage("新增商品失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }

  async function updatePricing(event: React.FormEvent<HTMLFormElement>, product: Product) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = (name: string) => {
      const raw = String(form.get(name) ?? "").trim();
      if (!raw) return null;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) throw new Error("invalid amount");
      return value;
    };

    let payload: { listPrice: number | null; wholesalePrice: number | null; unitCost: number | null };
    try {
      payload = { listPrice: amount("listPrice"), wholesalePrice: amount("wholesalePrice"), unitCost: amount("unitCost") };
    } catch {
      setMessage("價格與成本請輸入 0 以上的數字，或留白表示未設定");
      return;
    }

    setLoadingId(product.id); setMessage("");
    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) return setMessage(result.error ?? "價格更新失敗");
      setEditingId("");
      router.refresh();
    } catch {
      setMessage("價格更新失敗，請稍後再試");
    } finally {
      setLoadingId("");
    }
  }

  async function updateImage(event: React.FormEvent<HTMLFormElement>, product: Product) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const image = form.get("image");
    if (!(image instanceof File) || image.size <= 0) return setMessage("請先選擇要上傳的商品圖片");

    setLoadingId(product.id);
    setMessage("");
    try {
      const response = await fetch(`/api/products/${product.id}/image`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) return setMessage(result.error ?? "圖片更新失敗");
      setImageEditingId("");
      router.refresh();
    } catch {
      setMessage("圖片更新失敗，請稍後再試");
    } finally {
      setLoadingId("");
    }
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
    <PageHeader eyebrow="Master data" title="商品主檔" description="同一款商品可勾選多個尺寸一次建立 SKU，既有商品也能事後補上或更換圖片。" />
    {message && <div className="form-error">{message}</div>}
    {canWrite && <details className="panel drawer"><summary><span className="btn btn-primary"><Plus size={16} />新增商品</span></summary>
      <form className="form-grid" onSubmit={submit}>
        <div className="field"><label htmlFor="product-sku-base">SKU 基底</label><input className="input" id="product-sku-base" value={skuBase} onChange={(event) => setSkuBase(event.target.value)} placeholder="N202500" required /><span className="helper">勾選 M、L 後會建立 N202500-M、N202500-L。</span></div>
        <div className="field"><label htmlFor="product-name">商品名稱</label><input className="input" id="product-name" name="name" required /></div>
        <div className="field wide product-variant-picker"><label>尺寸</label><div className="product-size-options">
          {SIZE_OPTIONS.map((size) => <label className={`product-size-option ${selectedSizes.includes(size) ? "selected" : ""}`} key={size}><input type="checkbox" checked={selectedSizes.includes(size)} onChange={() => toggleSize(size)} /><span>{size}</span></label>)}
          <label className={`product-size-option ${includeNoSize ? "selected" : ""}`}><input type="checkbox" checked={includeNoSize} onChange={(event) => setIncludeNoSize(event.target.checked)} /><span>無尺寸</span></label>
        </div><span className="helper">多選尺寸會共用商品名稱、價格、成本、圖片與文案；「無尺寸」會直接使用 SKU 基底。</span></div>
        <div className="field"><label htmlFor="product-custom-sizes">其他尺寸</label><input className="input" id="product-custom-sizes" value={customSizes} onChange={(event) => setCustomSizes(event.target.value)} placeholder="例如 1, 2, 02" /><span className="helper">可用逗號分隔多個自訂尺寸。</span></div>
        <div className="field"><label htmlFor="product-safety">安全庫存</label><input className="input" id="product-safety" name="safetyStock" type="number" min="0" defaultValue="0" required /></div>
        <div className="field"><label htmlFor="product-list-price">定價</label><input className="input" id="product-list-price" name="listPrice" type="number" min="0" step="0.01" /></div>
        <div className="field"><label htmlFor="product-wholesale-price">經銷價</label><input className="input" id="product-wholesale-price" name="wholesalePrice" type="number" min="0" step="0.01" /></div>
        <div className="field"><label htmlFor="product-cost">單位成本</label><input className="input" id="product-cost" name="unitCost" type="number" min="0" step="0.01" /></div>
        <div className="field"><label htmlFor="product-image">商品圖片（選填）</label><input className="input file-input" id="product-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" /><span className="helper">JPEG、PNG 或 WebP，最大 8 MB；批次建立時所有 SKU 共用此圖片。</span></div>
        {previewSkus.length > 0 && <div className="field wide sku-preview"><label>即將建立 {previewSkus.length} 個 SKU</label><div>{previewSkus.map((sku) => <span className="badge" key={sku}>{sku}</span>)}</div></div>}
        <div className="field wide"><label htmlFor="product-description">商品文案</label><textarea className="textarea" id="product-description" name="description" rows={4} /></div>
        <div className="wide"><button className="btn btn-primary" disabled={loading || !variantSizes.length}>{loading ? "上傳並儲存中…" : `建立 ${variantSizes.length || ""} 個 SKU`}</button></div>
      </form>
    </details>}
    {canWrite && <p className="master-note">已有庫存異動的商品不可永久刪除，請改用停用以保留帳務歷史。</p>}
    <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>圖片</th><th>SKU</th><th>商品名稱</th><th>尺寸</th><th className="number">安全庫存</th><th className="number">定價</th><th className="number">經銷價</th><th className="number">單位成本</th><th>狀態</th>{canWrite && <th>操作</th>}</tr></thead>
      <tbody>{products.map((p) => <Fragment key={p.id}>
        <tr className={p.active ? undefined : "inactive-row"}>
          <td>{p.imageThumbPath ? <img className="product-thumb" src={`/api/uploads/${p.imageThumbPath}`} alt={`${p.name} 商品圖`} /> : <span className="product-thumb empty-thumb">無圖</span>}</td>
          <td className="sku">{p.sku}</td><td title={p.description ?? undefined}>{p.name}</td><td>{p.size ?? "—"}</td><td className="number">{p.safetyStock}</td>
          <td className="number">{p.listPrice == null ? "—" : `NT$ ${p.listPrice.toLocaleString()}`}</td><td className="number">{p.wholesalePrice == null ? "—" : `NT$ ${p.wholesalePrice.toLocaleString()}`}</td><td className="number">{p.unitCost == null ? "—" : `NT$ ${p.unitCost.toLocaleString()}`}</td>
          <td><span className={`badge ${p.active ? "green" : ""}`}>{p.active ? "啟用" : "停用"}</span></td>
          {canWrite && <td><div className="row-actions">
            <button className="btn btn-secondary icon-btn" disabled={loadingId === p.id} onClick={() => { setImageEditingId(imageEditingId === p.id ? "" : p.id); setEditingId(""); }} title={p.imageThumbPath ? "更換商品圖片" : "補上商品圖片"} aria-label={`${p.imageThumbPath ? "更換" : "補上"} ${p.sku} 圖片`} aria-expanded={imageEditingId === p.id}><ImagePlus size={15} /></button>
            {canEditPricing && <button className="btn btn-secondary icon-btn" disabled={loadingId === p.id} onClick={() => { setEditingId(editingId === p.id ? "" : p.id); setImageEditingId(""); }} title="編輯定價、經銷價與單位成本" aria-label={`編輯 ${p.sku} 價格`} aria-expanded={editingId === p.id}><Pencil size={15} /></button>}
            <button className="btn btn-secondary icon-btn" disabled={loadingId === p.id} onClick={() => toggleProduct(p)} title={p.active ? "停用商品" : "啟用商品"} aria-label={`${p.active ? "停用" : "啟用"} ${p.sku}`}>{p.active ? <PowerOff size={15} /> : <Power size={15} />}</button>
            <button className="btn btn-danger icon-btn" disabled={loadingId === p.id || p.movementCount > 0} onClick={() => deleteProduct(p)} title={p.movementCount > 0 ? `已有 ${p.movementCount} 筆異動，請改用停用` : "永久刪除商品"} aria-label={`刪除 ${p.sku}`}><Trash2 size={15} /></button>
          </div></td>}
        </tr>
        {imageEditingId === p.id && <tr className="product-price-editor-row"><td colSpan={10}>
          <form className="product-price-editor product-image-editor" onSubmit={(event) => updateImage(event, p)}>
            <div className="product-price-editor-heading"><div><strong>{p.imageThumbPath ? "更換商品圖片" : "補上商品圖片"}</strong><span>{p.sku} · {p.name}</span></div><span className="badge">商品圖片</span></div>
            <div className="field"><label htmlFor={`product-image-${p.id}`}>新圖片</label><input className="input file-input" id={`product-image-${p.id}`} name="image" type="file" accept="image/jpeg,image/png,image/webp" required /><span className="helper">JPEG、PNG 或 WebP，最大 8 MB。</span></div>
            <label className="product-image-scope"><input type="checkbox" name="applyToSameName" defaultChecked /><span><strong>套用到同商品名稱的所有 SKU</strong><small>適合同一款不同尺寸共用同一張商品圖；若此 SKU 需要獨立圖片可取消勾選。</small></span></label>
            <div className="product-price-editor-actions"><button className="btn btn-secondary" type="button" disabled={loadingId === p.id} onClick={() => setImageEditingId("")}>取消</button><button className="btn btn-primary" disabled={loadingId === p.id}>{loadingId === p.id ? "上傳中…" : "儲存圖片"}</button></div>
          </form>
        </td></tr>}
        {canEditPricing && editingId === p.id && <tr className="product-price-editor-row"><td colSpan={10}>
          <form className="product-price-editor" onSubmit={(event) => updatePricing(event, p)}>
            <div className="product-price-editor-heading"><div><strong>編輯價格</strong><span>{p.sku} · {p.name}</span></div><span className="badge">僅管理員</span></div>
            <div className="field"><label htmlFor={`list-price-${p.id}`}>定價</label><input className="input" id={`list-price-${p.id}`} name="listPrice" type="number" min="0" step="0.01" defaultValue={p.listPrice ?? ""} placeholder="未設定" /></div>
            <div className="field"><label htmlFor={`wholesale-price-${p.id}`}>經銷價</label><input className="input" id={`wholesale-price-${p.id}`} name="wholesalePrice" type="number" min="0" step="0.01" defaultValue={p.wholesalePrice ?? ""} placeholder="未設定" /></div>
            <div className="field"><label htmlFor={`unit-cost-${p.id}`}>單位成本</label><input className="input" id={`unit-cost-${p.id}`} name="unitCost" type="number" min="0" step="0.01" defaultValue={p.unitCost ?? ""} placeholder="未設定" /></div>
            <div className="product-price-editor-actions"><button className="btn btn-secondary" type="button" disabled={loadingId === p.id} onClick={() => setEditingId("")}>取消</button><button className="btn btn-primary" disabled={loadingId === p.id}>{loadingId === p.id ? "儲存中…" : "儲存價格"}</button></div>
          </form>
        </td></tr>}
      </Fragment>)}</tbody>
    </table></div></div>
  </>;
}
