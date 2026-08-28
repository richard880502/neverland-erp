"use client";

import { useMemo, useState } from "react";
import { ClipboardPaste, Plus, Trash2 } from "lucide-react";
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

export function MovementBatchEntry({ products, channels }: { products: Product[]; channels: Channel[] }) {
  const router = useRouter();
  const today = new Date().toLocaleDateString("en-CA");
  const [occurredAt, setOccurredAt] = useState(today);
  const [type, setType] = useState<MovementType>("CONSIGN_SOLD");
  const [channelId, setChannelId] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [commonNote, setCommonNote] = useState("");
  const [rows, setRows] = useState<BatchRow[]>([emptyRow("initial")]);
  const [pasteText, setPasteText] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const sortedProducts = useMemo(() => [...products].sort((a, b) => a.sku.localeCompare(b.sku, "zh-Hant", { numeric: true })), [products]);
  const listId = "movement-batch-products";

  function resolveProduct(value: string) {
    const key = normalize(value);
    return products.find((product) => normalize(product.sku) === key || normalize(productLabel(product)) === key) ?? null;
  }

  function resolveProductNameSize(name: string, size: string) {
    const normalizedName = normalize(name);
    const normalizedSize = normalize(size);
    const matches = products.filter((product) => normalize(product.name) === normalizedName && normalize(product.size) === normalizedSize);
    return matches.length === 1 ? matches[0] : null;
  }

  function updateRow(id: string, patch: Partial<BatchRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function updateProduct(id: string, value: string) {
    const product = resolveProduct(value);
    updateRow(id, { productKey: value, productId: product?.id ?? "" });
  }

  function parsePaste() {
    const lines = pasteText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return setMessage("請先從試算表複製資料貼到文字框");
    let unresolved = 0;
    let invalidQuantity = 0;
    const parsed: BatchRow[] = [];

    for (const line of lines) {
      const cells = line.split("\t").map((cell) => cell.trim());
      if (!cells[0]) continue;
      const headerText = cells.join(" ").toLocaleLowerCase();
      if ((headerText.includes("sku") || headerText.includes("商品")) && (headerText.includes("數量") || headerText.includes("qty"))) continue;

      let product = resolveProduct(cells[0]);
      let quantityIndex = 1;
      let displayKey = cells[0];
      if (!product && cells.length >= 3) {
        product = resolveProductNameSize(cells[0], cells[1]);
        quantityIndex = 2;
        if (product) displayKey = productLabel(product);
      }
      if (!product) unresolved += 1;
      const quantity = cells[quantityIndex] ?? "1";
      if (!Number.isInteger(Number(quantity)) || Number(quantity) <= 0) invalidQuantity += 1;
      parsed.push({
        id: crypto.randomUUID(),
        productKey: product ? productLabel(product) : displayKey,
        productId: product?.id ?? "",
        quantity,
        unitPrice: cells[quantityIndex + 1] ?? "",
        note: cells.slice(quantityIndex + 2).join(" "),
      });
    }

    if (!parsed.length) return setMessage("沒有解析到可使用的資料列");
    setRows(parsed);
    setMessage(`已解析 ${parsed.length} 筆${unresolved ? `；${unresolved} 筆商品尚未匹配` : ""}${invalidQuantity ? `；${invalidQuantity} 筆數量格式需確認` : ""}。`);
  }

  async function submitBatch() {
    setMessage("");
    const activeRows = rows.filter((row) => row.productKey.trim() || row.productId || row.quantity !== "1" || row.unitPrice || row.note);
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
    setPasteText("");
    setMessage(`已一次寫入 ${created} 筆；日期、事件、通路與單號已保留，可繼續下一批。`);
    router.refresh();
  }

  return <details className="panel drawer" open>
    <summary><span className="btn btn-primary"><Plus size={16} />批次登錄</span></summary>
    <p className="helper" style={{ marginTop: 0 }}>適合月結經銷銷貨表：日期、事件、通路只設定一次，下面連續輸入商品。也可直接從 Google Sheets / Excel 複製多列貼上。</p>
    {message && <div className="form-error" style={{ background: "#fff8df", color: "#786b3d", borderColor: "#d3bd69" }}>{message}</div>}

    <div className="form-grid">
      <div className="field"><label>共同日期</label><input className="input" type="date" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></div>
      <div className="field"><label>共同事件</label><select className="select" value={type} onChange={(event) => setType(event.target.value as MovementType)}>{Object.entries(movementLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      <div className="field"><label>共同通路</label><select className="select" value={channelId} onChange={(event) => setChannelId(event.target.value)}><option value="">不指定</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name} · {channelTypeLabels[channel.type]}</option>)}</select></div>
      <div className="field"><label>共同單號 / 月結識別</label><input className="input" value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} placeholder="例如 Zipper 2026-07" /></div>
      <div className="field wide"><label>共同備註（選填）</label><input className="input" value={commonNote} onChange={(event) => setCommonNote(event.target.value)} placeholder="例如 7 月寄賣銷貨表" /></div>
    </div>

    <datalist id={listId}>{sortedProducts.map((product) => <option key={product.id} value={productLabel(product)} />)}</datalist>
    <div className="table-wrap" style={{ border: "1px solid var(--line)", marginBottom: 12 }}>
      <table>
        <thead><tr><th style={{ minWidth: 300 }}>商品 / SKU</th><th style={{ width: 110 }}>數量</th><th style={{ width: 150 }}>成交單價</th><th style={{ minWidth: 180 }}>單筆備註</th><th style={{ width: 58 }}></th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td><input className="input" list={listId} value={row.productKey} onChange={(event) => updateProduct(row.id, event.target.value)} placeholder="輸入 SKU 或選商品" style={{ minWidth: 280 }} /></td>
          <td><input className="input" type="number" min="1" value={row.quantity} onChange={(event) => updateRow(row.id, { quantity: event.target.value })} /></td>
          <td><input className="input" type="number" min="0" step="1" value={row.unitPrice} onChange={(event) => updateRow(row.id, { unitPrice: event.target.value })} placeholder={isSale(type) ? "必填" : "選填"} /></td>
          <td><input className="input" value={row.note} onChange={(event) => updateRow(row.id, { note: event.target.value })} placeholder="選填" /></td>
          <td><button className="btn btn-danger icon-btn" type="button" onClick={() => setRows((current) => current.length === 1 ? [emptyRow()] : current.filter((item) => item.id !== row.id))} title="刪除此列"><Trash2 size={14} /></button></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
      <button className="btn btn-secondary" type="button" onClick={() => setRows((current) => [...current, emptyRow()])}><Plus size={14} />新增一列</button>
      <span className="helper" style={{ alignSelf: "center" }}>同批資料不會在每列重複要求日期、事件與通路。</span>
    </div>

    <div className="field">
      <label>從試算表貼上</label>
      <textarea className="textarea" rows={4} value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={"格式 A：SKU[TAB]數量[TAB]單價[TAB]備註\n格式 B：商品名稱[TAB]尺寸[TAB]數量[TAB]單價[TAB]備註"} />
      <div><button className="btn btn-secondary" type="button" onClick={parsePaste}><ClipboardPaste size={14} />解析並放入表格</button></div>
    </div>

    <button className="btn btn-primary" type="button" disabled={loading} onClick={() => void submitBatch()}>{loading ? "批次寫入中…" : `一次寫入 ${rows.length} 筆`}</button>
  </details>;
}
