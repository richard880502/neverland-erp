/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRightLeft, MapPin, Warehouse } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getInventoryRows } from "@/lib/data";

export default async function InventoryProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const baseProduct = await prisma.product.findUnique({ where: { id }, select: { name: true, imagePath: true, imageThumbPath: true } });
  if (!baseProduct) notFound();
  const allRows = await getInventoryRows();
  const variants = allRows.filter((row) => baseProduct.imagePath ? row.imagePath === baseProduct.imagePath : row.name === baseProduct.name);
  if (variants.length === 0) notFound();

  const warehouse = variants.reduce((sum, row) => sum + row.warehouse, 0);
  const consignment = variants.reduce((sum, row) => sum + row.consignment, 0);
  const total = variants.reduce((sum, row) => sum + row.total, 0);
  const locationMap = new Map<string, { name: string; quantity: number; sizes: Set<string> }>();
  for (const row of variants) for (const location of row.locations) {
    const current = locationMap.get(location.id) ?? { name: location.name, quantity: 0, sizes: new Set<string>() };
    current.quantity += location.quantity;
    if (location.quantity > 0) current.sizes.add(row.size ?? row.sku);
    locationMap.set(location.id, current);
  }
  const locationSummary = [...locationMap.entries()].map(([id, value]) => ({ id, ...value, sizes: [...value.sizes] })).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "zh-Hant"));

  return <div className="inventory-detail">
    <Link href="/inventory" className="inventory-back"><ArrowLeft size={16} />回到商品庫存</Link>
    <header className="inventory-detail-hero">
      <div className="inventory-detail-image">{baseProduct.imagePath ? <img src={`/api/uploads/${baseProduct.imagePath}`} alt={`${baseProduct.name} 商品圖`} /> : <span>NO IMAGE</span>}</div>
      <div className="inventory-detail-copy"><div className="eyebrow">Inventory by product</div><h1>{baseProduct.name}</h1><p>每個尺寸分開計算即時庫存；有正庫存的總倉或據點即為可評估的調貨來源。</p><div className="inventory-detail-stats"><div><span>帳面總庫存</span><strong>{total}</strong></div><div><span>總倉</span><strong>{warehouse}</strong></div><div><span>外部據點</span><strong>{consignment}</strong></div><div><span>尺寸種類</span><strong>{variants.length}</strong></div></div></div>
    </header>

    <section className="inventory-detail-section">
      <div className="inventory-section-title"><div><span>01 / VARIANTS</span><h2>各尺寸即時庫存與調貨來源</h2></div><small>負數代表來源異動需要核對</small></div>
      <div className="variant-stock-grid">{variants.map((variant) => {
        const sources = [
          ...(variant.warehouse > 0 ? [{ id: "warehouse", name: "總倉", quantity: variant.warehouse }] : []),
          ...variant.locations.filter((location) => location.quantity > 0),
        ].sort((a, b) => b.quantity - a.quantity);
        return <article className="variant-stock-card" key={variant.id}>
          <div className="variant-stock-header"><div><span>{variant.sku}</span><h3>{variant.size ?? "單一尺寸"}</h3></div><div className={`variant-total ${variant.total <= 0 ? "negative" : ""}`}><small>可用總量</small><strong>{variant.total}</strong></div></div>
          <div className="variant-balance"><div><Warehouse size={16} /><span>總倉</span><strong>{variant.warehouse}</strong></div><div><MapPin size={16} /><span>在外</span><strong>{variant.consignment}</strong></div><div><span>安全庫存</span><strong>{variant.safetyStock}</strong></div></div>
          <div className="variant-sources"><span><ArrowRightLeft size={14} />可調貨來源</span>{sources.length > 0 ? <div>{sources.map((source) => <div className="source-row" key={source.id}><span>{source.name}</span><strong>{source.quantity} 件</strong></div>)}</div> : <p>目前沒有正庫存可供調貨</p>}</div>
          {variant.locations.some((location) => location.quantity < 0) && <div className="stock-warning">異常：{variant.locations.filter((location) => location.quantity < 0).map((location) => `${location.name} ${location.quantity}`).join("、")}</div>}
        </article>;
      })}</div>
    </section>

    <section className="inventory-detail-section">
      <div className="inventory-section-title"><div><span>02 / LOCATIONS</span><h2>據點庫存總覽</h2></div><small>彙總此商品的所有尺寸</small></div>
      <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>庫存地點</th><th className="number">現有數量</th><th>有貨尺寸</th><th>調貨判斷</th></tr></thead><tbody><tr><td><strong>總倉</strong></td><td className="number">{warehouse}</td><td>{variants.filter((row) => row.warehouse > 0).map((row) => row.size ?? row.sku).join("、") || "—"}</td><td><span className={`badge ${warehouse > 0 ? "green" : "warn"}`}>{warehouse > 0 ? "可調貨" : "無現貨"}</span></td></tr>{locationSummary.map((location) => <tr key={location.id}><td>{location.name}</td><td className="number">{location.quantity}</td><td>{location.sizes.join("、") || "—"}</td><td><span className={`badge ${location.quantity > 0 ? "green" : "warn"}`}>{location.quantity > 0 ? "可評估調貨" : location.quantity < 0 ? "需核對" : "無現貨"}</span></td></tr>)}</tbody></table></div></div>
    </section>
  </div>;
}
