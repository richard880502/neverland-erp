"use client";

import { useMemo, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { channelTypeLabels, isSale, movementLabels } from "@/lib/inventory";
import type { ChannelType, MovementType } from "@prisma/client";

type Product = { id: string; sku: string; name: string; size: string | null; listPrice: number | null };
type Channel = { id: string; name: string; type: ChannelType };
type BatchRow = {
  id: string;
  productKey: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  note: string;
};

const channelRequiredTypes: MovementType[] = ["SHIP", "SALES_RETURN", "CONSIGN_OUT", "CONSIGN_RETURN", "CONSIGN_SOLD", "BUYOUT"];

function productLabel(product: Product) {
  return `${product.sku} · ${product.name}${product.size ? ` · ${product.size}` : ""}`;
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("zh-Hant").replace(/\s+/g, " ");
}

function emptyRow(id = crypto.randomUUID()): BatchRow {
  return { id, productKey: "", productId: "", quantity: "1", unitPrice: "", note: "" };
}

function rowHasContent(row: BatchRow) {
  return Boolean(row.productKey.trim() || row.productId || row.quantity !== "1" || row.unitPrice || row.note);
}

export function MovementBatchEntry({ products, channels }: { products: Product[]; channels: Channel[] }) {
  const router = useRouter();
  const today = new Date().toLocaleDateString("en-CA");
  const [occurredAt, setOccurredAt] = useState(today);
  const [type, setType] = useState<MovementType>("CONSIGN_SOLD");
  const [channelId, setChannelId] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [commonNote, setCommonNote] = useState("");
  const [rows, setRows] = useState<BatchRow[]>([emptyRow("initial")]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const sortedProducts = useMemo(() => [...products].sort((a, b) => a.sku.localeCompare(b.sku, "zh-Hant", { numeric: true })), [products]);
  const activeRowCount = useMemo(() => rows.filter(rowHasContent).length, [rows]);
  const listId = "movement-batch-products";

  function resolveProduct(value: string) {
    const key = normalize(value);
    return products.find((product) => normalize(product.sku) === key || normalize(productLabel(product)) === key) ?? null;
  }

  function updateRow(id: string, patch: Partial<BatchRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function updateProduct(id: string, value: string) {
    const product = resolveProduct(value);
    updateRow(id, { productKey: value, productId: product?.id ?? "" });
  }

  function duplicateRow(id: string) {
    setRows((current) => {
      const index = current.findIndex((row) => row.id === id);
      if (index < 0) return current;
      const source = current[index];
      const copy = { ...source, id: crypto.randomUUID() };
      return [...current.slice(0, index + 1), copy, ...current.slice(index + 1)];
    });
    setMessage("已複製一列；只需要修改不同的商品、數量、單價或備註。");
  }

  function duplicateLastRow() {
    setRows((current) => {
      const source = [...current].reverse().find(rowHasContent);
      if (!source) return [...current, emptyRow()];
      return [...current, { ...source, id: crypto.randomUUID() }];
    });
    setMessage("已沿用上一列內容新增一列。");
  }

  async function submitBatch() {
    setMessage("");
    const activeRows = rows.filter(rowHasContent);
    if (!occurredAt) return setMessage("請選擇共同日期");
    if (channelRequiredTypes.includes(type) && !channelId) return setMessage("這個事件需要先選擇共同通路");
    if (!activeRows.length) return setMessage("請至少加入一筆商品資料");
    const invalidProductIndex = activeRows.findIndex((row) => !row.productId);
    if (invalidProductIndex >= 0) return setMessage(`第 ${invalidProductIndex + 1} 筆商品尚未匹配，請選擇候選商品或輸入完整 SKU`);
    const invalidQuantityIndex = activeRows.findIndex((row) => !Number.isInteger(Number(row.quantity)) || Number(row.quantity) <= 0);
    if (invalidQuantityIndex >= 0) return setMessage(`第 ${invalidQuantityIndex + 1} 筆數量不正確`);
    const missingPriceIndex = isSale(type) ? activeRows.findIndex((row) => row.unitPrice === "" || Number(row.unitPrice) < 0) : -1;
    if (missingPriceIndex >= 0) return setMessage(`第 ${missingPriceIndex + 1} 筆需要填成交單價`);

    setLoading(true);
    let created = 0;
    for (let index = 0; index < activeRows.length; index += 1) {
      const row = activeRows[index];
      const response = await fetch("/api/movements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          occurredAt,
          type,
          channelId: channelId || "",
          productId: row.productId,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          referenceNo,
          note: [commonNote, row.note].filter(Boolean).join("；"),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setLoading(false);
        setRows(activeRows.slice(index));
        setMessage(`已成功寫入 ${created} 筆；第 ${index + 1} 筆失敗：${result.error ?? "異動無法儲存"}。未寫入的資料已保留，可修正後繼續。`);
        router.refresh();
        return;
      }
      created += 1;
    }

    setLoading(false);
    setRows([emptyRow()]);
    setMessage(`已一次寫入 ${created} 筆；日期、事件、通路與單號已保留，可繼續下一批。`);
    router.refresh();
  }

  return <details className="panel drawer" open>
    <summary><span className="btn btn-primary"><Plus size={16} />批次登錄</span></summary>
    <p className="helper" style={{ marginTop: 0 }}>適合月結經銷銷貨：日期、事件、通路只設定一次。需要重複相近資料時，直接複製上一列或指定列，再修改不同欄位即可。</p>
    {message && <div className="form-error" style={{ background: "#fff8df", color: "#786b3d", borderColor: "#d3bd69" }}>{message}</div>}

    <div className="form-grid">
      <div className="field"><label>共同日期</label><input className="input" type="date" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></div>
      <div className="field"><label>共同事件</label><select className="select" value={type} onChange={(event) => setType(event.target.value as MovementType)}>{Object.entries(movementLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      <div className="field"><label>共同通路</label><select className="select" value={channelId} onChange={(event) => setChannelId(event.target.value)}><option value="">不指定</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name} · {channelTypeLabels[channel.type]}</option>)}</select></div>
      <div className="field"><label>共同單號 / 月結識別</label><input className="input" value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} placeholder="例如 Zipper 2026-07" /></div>
      <div className="field wide"><label>共同備註（選填）</label><input className="input" value={commonNote} onChange={(event) => setCommonNote(event.target.value)} placeholder="例如 7 月寄賣銷貨" /></div>
    </div>

    <datalist id={listId}>{sortedProducts.map((product) => <option key={product.id} value={productLabel(product)} />)}</datalist>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
      <span className="helper">同一批共同資料不會重複要求輸入；相近商品可複製一列後直接修改。</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-secondary" type="button" onClick={() => setRows((current) => [...current, emptyRow()])}><Plus size={14} />新增空白列</button>
        <button className="btn btn-secondary" type="button" onClick={duplicateLastRow}><Copy size={14} />複製上一列</button>
      </div>
    </div>
    <div className="table-wrap" style={{ border: "1px solid var(--line)", marginBottom: 12 }}>
      <table>
        <thead><tr><th style={{ minWidth: 300 }}>商品 / SKU</th><th style={{ width: 110 }}>數量</th><th style={{ width: 150 }}>成交單價</th><th style={{ minWidth: 180 }}>單筆備註</th><th style={{ width: 104 }}></th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td><input className="input" list={listId} value={row.productKey} onChange={(event) => updateProduct(row.id, event.target.value)} placeholder="輸入 SKU 或選商品" style={{ minWidth: 280 }} aria-invalid={Boolean(row.productKey && !row.productId)} /></td>
          <td><input className="input" type="number" min="1" value={row.quantity} onChange={(event) => updateRow(row.id, { quantity: event.target.value })} /></td>
          <td><input className="input" type="number" min="0" step="1" value={row.unitPrice} onChange={(event) => updateRow(row.id, { unitPrice: event.target.value })} placeholder={isSale(type) ? "必填" : "選填"} /></td>
          <td><input className="input" value={row.note} onChange={(event) => updateRow(row.id, { note: event.target.value })} placeholder="選填" /></td>
          <td><div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button className="btn btn-secondary icon-btn" type="button" onClick={() => duplicateRow(row.id)} title="複製此列"><Copy size={14} /></button>
            <button className="btn btn-danger icon-btn" type="button" onClick={() => setRows((current) => current.length === 1 ? [emptyRow()] : current.filter((item) => item.id !== row.id))} title="刪除此列"><Trash2 size={14} /></button>
          </div></td>
        </tr>)}</tbody>
      </table>
    </div>

    <button className="btn btn-primary" type="button" disabled={loading || activeRowCount === 0} onClick={() => void submitBatch()}>{loading ? "批次寫入中…" : `一次寫入 ${activeRowCount} 筆`}</button>
  </details>;
}
