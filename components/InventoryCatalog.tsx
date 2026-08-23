"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Boxes, MapPin, Search, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";

type LocationStock = { id: string; name: string; type: string; quantity: number };
type InventoryRow = {
  id: string;
  sku: string;
  name: string;
  size: string | null;
  imagePath: string | null;
  imageThumbPath: string | null;
  safetyStock: number;
  warehouse: number;
  consignment: number;
  sold: number;
  defect: number;
  total: number;
  status: string;
  locations: LocationStock[];
};

type ProductGroup = {
  key: string;
  representativeId: string;
  name: string;
  imagePath: string | null;
  imageThumbPath: string | null;
  variants: InventoryRow[];
  warehouse: number;
  consignment: number;
  total: number;
  sold: number;
  lowStock: boolean;
  transferSources: Array<{ id: string; name: string; quantity: number }>;
};

function groupRows(rows: InventoryRow[]) {
  const groups = new Map<string, InventoryRow[]>();
  for (const row of rows) {
    const key = row.imagePath ? `image:${row.imagePath}` : `name:${row.name}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([key, variants]): ProductGroup => {
    const locationTotals = new Map<string, { id: string; name: string; quantity: number }>();
    const warehouse = variants.reduce((sum, row) => sum + row.warehouse, 0);
    for (const row of variants) {
      for (const location of row.locations) {
        const current = locationTotals.get(location.id) ?? { id: location.id, name: location.name, quantity: 0 };
        current.quantity += location.quantity;
        locationTotals.set(location.id, current);
      }
    }
    return {
      key,
      representativeId: variants[0].id,
      name: variants[0].name,
      imagePath: variants[0].imagePath,
      imageThumbPath: variants[0].imageThumbPath,
      variants,
      warehouse,
      consignment: variants.reduce((sum, row) => sum + row.consignment, 0),
      total: variants.reduce((sum, row) => sum + row.total, 0),
      sold: variants.reduce((sum, row) => sum + row.sold, 0),
      lowStock: variants.some((row) => row.warehouse <= row.safetyStock),
      transferSources: [
        ...(warehouse > 0 ? [{ id: "warehouse", name: "總倉", quantity: warehouse }] : []),
        ...[...locationTotals.values()].filter((location) => location.quantity > 0),
      ].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "zh-Hant")),
    };
  });
}

export function InventoryCatalog({ rows, locations }: { rows: InventoryRow[]; locations: Array<{ id: string; name: string }> }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [location, setLocation] = useState("all");
  const [sort, setSort] = useState("name");
  const groups = useMemo(() => groupRows(rows), [rows]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-Hant");
    return groups.filter((group) => {
      const matchesQuery = !keyword || group.name.toLocaleLowerCase("zh-Hant").includes(keyword) || group.variants.some((row) => `${row.sku} ${row.size ?? ""}`.toLocaleLowerCase("zh-Hant").includes(keyword));
      const matchesStatus = status === "all" || (status === "available" && group.total > 0) || (status === "low" && group.lowStock) || (status === "out" && group.total <= 0);
      const matchesLocation = location === "all" || (location === "warehouse" ? group.warehouse > 0 : group.variants.some((row) => row.locations.some((item) => item.id === location && item.quantity > 0)));
      return matchesQuery && matchesStatus && matchesLocation;
    }).sort((a, b) => {
      if (sort === "stock-desc") return b.total - a.total || a.name.localeCompare(b.name, "zh-Hant");
      if (sort === "stock-asc") return a.total - b.total || a.name.localeCompare(b.name, "zh-Hant");
      if (sort === "warehouse") return b.warehouse - a.warehouse || a.name.localeCompare(b.name, "zh-Hant");
      if (sort === "variants") return b.variants.length - a.variants.length || a.name.localeCompare(b.name, "zh-Hant");
      return a.name.localeCompare(b.name, "zh-Hant");
    });
  }, [groups, location, query, sort, status]);

  return (
    <div className="inventory-catalog">
      <PageHeader
        className="inventory-heading"
        eyebrow="Inventory"
        title="即時庫存"
        description="先找商品，再查看尺寸與各據點現貨，快速判斷可以從哪裡調貨。"
        actions={<div className="inventory-result-count"><strong>{filtered.length}</strong><span>／ {groups.length} 款商品</span></div>}
      />

      <section className="inventory-tools" aria-label="庫存搜尋與篩選">
        <label className="inventory-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋商品名稱、SKU 或尺寸" aria-label="搜尋商品" /></label>
        <label className="inventory-select"><SlidersHorizontal size={16} /><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="庫存狀態"><option value="all">全部庫存狀態</option><option value="available">仍有現貨</option><option value="low">需要補貨</option><option value="out">已無庫存</option></select></label>
        <label className="inventory-select"><MapPin size={16} /><select value={location} onChange={(event) => setLocation(event.target.value)} aria-label="庫存地點"><option value="all">全部地點</option><option value="warehouse">總倉有貨</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name} 有貨</option>)}</select></label>
        <label className="inventory-select"><Boxes size={16} /><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="排序方式"><option value="name">商品名稱 A–Z</option><option value="stock-desc">庫存多到少</option><option value="stock-asc">庫存少到多</option><option value="warehouse">總倉庫存優先</option><option value="variants">尺寸種類多到少</option></select></label>
      </section>

      {filtered.length > 0 ? <div className="inventory-product-grid">
        {filtered.map((group) => <Link className="inventory-product-card" href={`/inventory/${group.representativeId}`} key={group.key}>
          <div className="inventory-product-image">{group.imagePath ? <img src={`/api/uploads/${group.imagePath}`} alt={`${group.name} 商品圖`} /> : <span>NO IMAGE</span>}<em>{group.variants.length} 種尺寸</em></div>
          <div className="inventory-product-body">
            <div className="inventory-card-title"><div><span>AVAILABLE STOCK</span><h2>{group.name}</h2></div><ArrowRight size={18} /></div>
            <div className="inventory-card-numbers"><div><span>總庫存</span><strong>{group.total}</strong></div><div><span>總倉</span><strong>{group.warehouse}</strong></div><div><span>在外</span><strong>{group.consignment}</strong></div></div>
            <div className="transfer-preview"><span>可調貨來源</span>{group.transferSources.length > 0 ? <div>{group.transferSources.slice(0, 3).map((source) => <small key={source.id}>{source.name} <b>{source.quantity}</b></small>)}{group.transferSources.length > 3 && <small>+{group.transferSources.length - 3}</small>}</div> : <small className="no-transfer">目前無可調庫存</small>}</div>
            <div className="inventory-card-footer"><span className={`badge ${group.lowStock ? "warn" : "green"}`}>{group.lowStock ? "部分尺寸需補貨" : "庫存正常"}</span><span>查看尺寸與地點</span></div>
          </div>
        </Link>)}
      </div> : <div className="panel inventory-empty"><Search size={24} /><h2>找不到符合條件的商品</h2><p>請調整關鍵字、庫存狀態或地點篩選。</p><button className="btn btn-secondary" onClick={() => { setQuery(""); setStatus("all"); setLocation("all"); }}>清除篩選</button></div>}
    </div>
  );
}
