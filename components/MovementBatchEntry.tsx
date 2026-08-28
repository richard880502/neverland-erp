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

    <div style={{ padding: 18 }}>
      {message && <div className="form-error" style={{ background: "#fff8df", color: "#786b3d", borderColor: "#d3bd69" }}>{message}</div>}

      <div className="form-grid" style={{ padding: 0 }}>
        <div className="field"><label>共同日期</label><input className="input" type="date" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></div>
        <div className="field"><label>共同事件</label><select className="select" value={type} onChange={(event) => setType(event.target.value as MovementType)}>{Object.entries(movementLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
        <div className="field"><label>共同通路</label><select className="select" value={channelId} onChange={(event) => setChannelId(event.target.value)}><option value="">不指定</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name} · {channelTypeLabels[channel.type]}</option>)}</select></div>
        <div className="field"><label>共同單號 / 月結識別</label><input className="input" value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} placeholder="例如 Zipper 2026-07" /></div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginTop: 16, marginBottom: 18 }}>
        <div className="field" style={{ flex: "1 1 420px", minWidth: 280, marginBottom: 0 }}><label>共同備註（選填）</label><input className="input" value={commonNote} onChange={(event) => setCommonNote(event.target.value)} placeholder="例如 7 月寄賣銷貨" /></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-secondary" style={{ height: 38 }} type="button" onClick={() => setRows((current) => [...current, emptyRow()])}><Plus size={14} />新增空白列</button>
          <button className="btn btn-secondary" style={{ height: 38 }} type="button" onClick={duplicateLastRow}><Copy size={14} />複製上一列</button>
        </div>
      </div>

      <datalist id={listId}>{sortedProducts.map((product) => <option key={product.id} value={productLabel(product)} />)}</datalist>
      <div className="table-wrap" style={{ border: "1px solid var(--line)", marginBottom: 12 }}>
        <table style={{ width: "100%", minWidth: 900, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "42%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: 96 }} />
          </colgroup>
          <thead><tr><th>商品 / SKU</th><th>數量</th><th>成交單價</th><th>單筆備註</th><th style={{ textAlign: "center" }}>操作</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}>
            <td style={{ verticalAlign: "middle" }}><input className="input" list={listId} value={row.productKey} onChange={(event) => updateProduct(row.id, event.target.value)} placeholder="輸入 SKU 或選商品" style={{ width: "100%", minWidth: 0 }} aria-invalid={Boolean(row.productKey && !row.productId)} /></td>
            <td style={{ verticalAlign: "middle" }}><input className="input" type="number" min="1" value={row.quantity} onChange={(event) => updateRow(row.id, { quantity: event.target.value })} style={{ width: "100%", minWidth: 0 }} /></td>
            <td style={{ verticalAlign: "middle" }}><input className="input" type="number" min="0" step="1" value={row.unitPrice} onChange={(event) => updateRow(row.id, { unitPrice: event.target.value })} placeholder={isSale(type) ? "必填" : "選填"} style={{ width: "100%", minWidth: 0 }} /></td>
            <td style={{ verticalAlign: "middle" }}><input className="input" value={row.note} onChange={(event) => updateRow(row.id, { note: event.target.value })} placeholder="選填" style={{ width: "100%", minWidth: 0 }} /></td>
            <td style={{ verticalAlign: "middle" }}><div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center" }}>
              <button className="btn btn-secondary icon-btn" type="button" onClick={() => duplicateRow(row.id)} title="複製此列"><Copy size={14} /></button>
              <button className="btn btn-danger icon-btn" type="button" onClick={() => setRows((current) => current.length === 1 ? [emptyRow()] : current.filter((item) => item.id !== row.id))} title="刪除此列"><Trash2 size={14} /></button>
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span className="helper">同一批共同資料只設定一次；每列只填商品、數量、單價與備註。</span>
        <button className="btn btn-primary" type="button" disabled={loading || activeRowCount === 0} onClick={() => void submitBatch()}>{loading ? "批次寫入中…" : `一次寫入 ${activeRowCount} 筆`}</button>
      </div>
    </div>
  </details>;
}
