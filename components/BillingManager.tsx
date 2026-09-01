"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Search, Store, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";

type Channel = {
  id: string;
  name: string;
  type: "CONSIGNMENT" | "BUYOUT";
  companyName: string | null;
  taxId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  billingAddress: string | null;
  settlementRate: number | null;
  taxRate: number | null;
  paymentTermsDays: number | null;
};

type Product = { id: string; sku: string; name: string; size: string | null; listPrice: number | null };
type ItemRow = { id: number; productId: string; quantity: string };
type Statement = {
  id: string;
  statementNo: string;
  companyName: string;
  channelName: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  status: "DRAFT" | "ISSUED" | "PAID" | "VOID";
  issuedAt: string;
};
type AutofillResult = {
  sourceType: "CONSIGNMENT" | "BUYOUT";
  sourceMovementCount: number;
  sourceMovementIds: string[];
  items: Array<{ productId: string; sku: string; productName: string; size: string | null; listPrice: number | null; quantity: number }>;
};

const statusLabels = { DRAFT: "草稿", ISSUED: "待收款", PAID: "已收款", VOID: "已作廢" } as const;

function localMonthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    start: `${year}-${pad(month + 1)}-01`,
    end: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
    today: `${year}-${pad(month + 1)}-${pad(now.getDate())}`,
  };
}

function money(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 2 }).format(value);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function BillingManager({
  channels,
  products,
  statements,
  canWrite,
  stats,
}: {
  channels: Channel[];
  products: Product[];
  statements: Statement[];
  canWrite: boolean;
  stats: { outstanding: number; paid: number; count: number };
}) {
  const router = useRouter();
  const range = localMonthRange();
  const initialChannel = channels[0] ?? null;
  const [channelId, setChannelId] = useState(initialChannel?.id ?? "");
  const [periodStart, setPeriodStart] = useState(range.start);
  const [periodEnd, setPeriodEnd] = useState(range.end);
  const [issuedAt, setIssuedAt] = useState(range.today);
  const [settlementPercent, setSettlementPercent] = useState(initialChannel?.settlementRate == null ? "" : String(initialChannel.settlementRate * 100));
  const [taxPercent, setTaxPercent] = useState(initialChannel?.taxRate == null ? "5" : String(initialChannel.taxRate * 100));
  const [shippingFee, setShippingFee] = useState("0");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<ItemRow[]>([{ id: 1, productId: "", quantity: "1" }]);
  const [nextRowId, setNextRowId] = useState(2);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [autofillLoading, setAutofillLoading] = useState(false);
  const [autofillMessage, setAutofillMessage] = useState("");
  const [autofillSourceCount, setAutofillSourceCount] = useState(0);
  const [sourceMovementIds, setSourceMovementIds] = useState<string[]>([]);
  const [autofillVersion, setAutofillVersion] = useState(0);

  const channel = channels.find((item) => item.id === channelId) ?? null;
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const settlementRate = Number(settlementPercent) / 100;
  const taxRate = Number(taxPercent) / 100;
  const shipping = Number(shippingFee || 0);
  const autoSettlement = sourceMovementIds.length > 0;

  useEffect(() => {
    if (!channelId || !periodStart || !periodEnd || periodStart > periodEnd) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setAutofillLoading(true);
      setAutofillMessage("");
      try {
        const params = new URLSearchParams({ channelId, periodStart, periodEnd });
        const response = await fetch(`/api/billing/preview?${params}`, { signal: controller.signal });
        const result = await response.json() as AutofillResult & { error?: string };
        if (!response.ok) {
          setAutofillMessage(result.error ?? "讀取待結算銷貨失敗");
          return;
        }
        const nextRows: ItemRow[] = result.items.length > 0
          ? result.items.map((item, index) => ({ id: index + 1, productId: item.productId, quantity: String(item.quantity) }))
          : [{ id: 1, productId: "", quantity: "1" }];
        setRows(nextRows);
        setNextRowId(nextRows.length + 1);
        setSourceMovementIds(result.sourceMovementIds ?? []);
        setAutofillSourceCount(result.sourceMovementCount);
        setAutofillMessage(result.items.length > 0
          ? `找到 ${result.sourceMovementCount} 筆尚未結算銷貨，已彙整成 ${result.items.length} 個 SKU。建立後會鎖定這些來源並同步一筆應收到收支。`
          : "這個期間沒有尚未結算的銷貨；若是例外請款，仍可手動新增品項。 ");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setAutofillMessage("讀取待結算銷貨失敗，你仍然可以手動建立請款。");
      } finally {
        if (!controller.signal.aborted) setAutofillLoading(false);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [channelId, periodStart, periodEnd, autofillVersion]);

  const previewItems = useMemo(() => {
    const grouped = new Map<string, { product: Product; quantity: number }>();
    for (const row of rows) {
      const product = productById.get(row.productId);
      const quantity = Number(row.quantity);
      if (!product || !Number.isInteger(quantity) || quantity <= 0) continue;
      const current = grouped.get(product.id);
      if (current) current.quantity += quantity;
      else grouped.set(product.id, { product, quantity });
    }
    return [...grouped.values()].map(({ product, quantity }) => {
      const listPrice = product.listPrice ?? 0;
      const settlementPrice = roundMoney(listPrice * (Number.isFinite(settlementRate) ? settlementRate : 0));
      return { product, quantity, listPrice, settlementPrice, subtotal: roundMoney(settlementPrice * quantity) };
    }).sort((a, b) => a.product.sku.localeCompare(b.product.sku, "zh-Hant", { numeric: true }));
  }, [rows, productById, settlementRate]);

  const subtotal = roundMoney(previewItems.reduce((sum, item) => sum + item.subtotal, 0));
  const taxAmount = roundMoney(subtotal * (Number.isFinite(taxRate) ? taxRate : 0));
  const totalAmount = roundMoney(subtotal + taxAmount + (Number.isFinite(shipping) ? shipping : 0));
  const hasMissingPrice = previewItems.some((item) => item.product.listPrice == null);
  const canCreate = Boolean(channel)
    && periodStart <= periodEnd
    && Number.isFinite(settlementRate) && settlementRate > 0 && settlementRate <= 1
    && Number.isFinite(taxRate) && taxRate >= 0 && taxRate <= 1
    && Number.isFinite(shipping) && shipping >= 0
    && previewItems.length > 0
    && !hasMissingPrice
    && !autofillLoading;

  function selectChannel(nextId: string) {
    const next = channels.find((item) => item.id === nextId) ?? null;
    setChannelId(nextId);
    setSettlementPercent(next?.settlementRate == null ? "" : String(next.settlementRate * 100));
    setTaxPercent(next?.taxRate == null ? "5" : String(next.taxRate * 100));
    setRows([{ id: 1, productId: "", quantity: "1" }]);
    setNextRowId(2);
    setAutofillSourceCount(0);
    setSourceMovementIds([]);
    setAutofillMessage("");
    setMessage("");
  }

  function updateRow(id: number, patch: Partial<ItemRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function addRow() {
    setRows((current) => [...current, { id: nextRowId, productId: "", quantity: "1" }]);
    setNextRowId((value) => value + 1);
  }

  function removeRow(id: number) {
    setRows((current) => current.length === 1 ? [{ id: current[0].id, productId: "", quantity: "1" }] : current.filter((row) => row.id !== id));
  }

  async function createStatement() {
    if (!canCreate || !channel) return;
    setSaving(true); setMessage("");
    const response = await fetch("/api/billing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channelId,
        periodStart,
        periodEnd,
        issuedAt,
        settlementRate,
        taxRate,
        shippingFee: shipping,
        note: note || null,
        sourceMovementIds,
        items: rows.filter((row) => row.productId).map((row) => ({ productId: row.productId, quantity: Number(row.quantity) })),
      }),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setMessage(result.error ?? "結算建立失敗");
    router.push(`/billing/${result.id}`);
    router.refresh();
  }

  const filteredStatements = statements.filter((statement) => {
    const needle = search.trim().toLowerCase();
    return !needle || statement.statementNo.toLowerCase().includes(needle) || statement.companyName.toLowerCase().includes(needle) || statement.channelName.toLowerCase().includes(needle);
  });

  return <div className="billing-page">
    <PageHeader eyebrow="Receivables" title="請款 / 結算管理" description="選通路與期間後，自動彙整尚未結算的銷貨；確認後鎖定來源異動，建立請款單並同步一筆應收到收支。" />

    <div className="billing-stats">
      <div><span>請款單</span><strong>{stats.count}</strong><small>STATEMENTS</small></div>
      <div><span>待收款</span><strong>{money(stats.outstanding)}</strong><small>OUTSTANDING</small></div>
      <div><span>已收款</span><strong>{money(stats.paid)}</strong><small>COLLECTED</small></div>
    </div>

    {canWrite && <section className="billing-create-grid">
      <div className="panel billing-form-panel">
        <div className="billing-section-head"><span>01 / SETTLEMENT</span><h2>建立結算</h2></div>
        {message && <div className="form-error">{message}</div>}
        <div className="field"><label>客戶 / 通路</label><select className="select" value={channelId} onChange={(event) => selectChannel(event.target.value)}><option value="">選擇客戶</option>{channels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.type === "CONSIGNMENT" ? "寄賣" : "買斷"}</option>)}</select></div>
        {channel && <div className="billing-customer-card">
          <div><Store size={16} /><strong>{channel.companyName || channel.name}</strong></div>
          <dl>
            <div><dt>統編</dt><dd>{channel.taxId || "—"}</dd></div><div><dt>聯絡人</dt><dd>{channel.contactName || "—"}</dd></div>
            <div><dt>電話</dt><dd>{channel.contactPhone || "—"}</dd></div><div><dt>Email</dt><dd>{channel.contactEmail || "—"}</dd></div>
            <div className="wide"><dt>地址</dt><dd>{channel.billingAddress || "—"}</dd></div>
          </dl>
        </div>}
        <div className="billing-two-col">
          <div className="field"><label>結算期間起日</label><input className="input" type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></div>
          <div className="field"><label>結算期間迄日</label><input className="input" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></div>
          <div className="field"><label>請款 / 入帳日期</label><input className="input" type="date" value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} /></div>
          <div className="field"><label>結算比例 (%)</label><input className="input" type="number" min="0.01" max="100" step="0.01" placeholder="例如 60" value={settlementPercent} onChange={(event) => setSettlementPercent(event.target.value)} /></div>
          <div className="field"><label>營業稅 (%)</label><input className="input" type="number" min="0" max="100" step="0.01" value={taxPercent} onChange={(event) => setTaxPercent(event.target.value)} /></div>
          <div className="field"><label>請款運費</label><input className="input" type="number" min="0" step="1" value={shippingFee} onChange={(event) => setShippingFee(event.target.value)} /></div>
        </div>
        <div className="billing-items-editor">
          <div className="billing-items-editor-head"><div><span>ITEMS</span><strong>{autoSettlement ? "待結算銷貨彙總" : "手動請款品項"}</strong></div><div className="billing-items-editor-actions"><button type="button" className="btn btn-secondary" disabled={autofillLoading || !channelId || periodStart > periodEnd} onClick={() => setAutofillVersion((value) => value + 1)}><RefreshCw size={14} />{autofillLoading ? "整理中…" : "重新整理待結算"}</button>{!autoSettlement && <button type="button" className="btn btn-secondary" onClick={addRow}><Plus size={14} />新增品項</button>}</div></div>
          {autofillMessage && <p className="billing-autofill-note">{autofillMessage}</p>}
          {rows.map((row) => <div className="billing-item-row" key={row.id}>
            <div className="field"><label>商品 / SKU</label><select className="select" disabled={autoSettlement} value={row.productId} onChange={(event) => updateRow(row.id, { productId: event.target.value })}><option value="">選擇商品</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}{product.size ? ` · ${product.size}` : ""}{product.listPrice == null ? " · 未設定售價" : ""}</option>)}</select></div>
            <div className="field"><label>數量</label><input className="input" type="number" min="1" step="1" disabled={autoSettlement} value={row.quantity} onChange={(event) => updateRow(row.id, { quantity: event.target.value })} /></div>
            {!autoSettlement && <button type="button" className="btn btn-danger billing-remove-item" onClick={() => removeRow(row.id)} title="移除品項"><Trash2 size={14} /></button>}
          </div>)}
        </div>
        {autoSettlement && <p className="billing-hint">這批品項由 {autofillSourceCount} 筆尚未結算的庫存銷貨產生，為確保可追溯性，商品與數量在此鎖定；若資料不對，請先修正庫存異動再重新整理。</p>}
        <div className="field"><label>備註</label><textarea className="textarea" rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></div>
        {channel && channel.settlementRate == null && <p className="billing-hint">此客戶尚未設定預設結算比例，本次可直接輸入；之後可到「通路主檔」保存。</p>}
      </div>

      <div className="panel billing-preview-panel">
        <div className="billing-section-head"><span>02 / PREVIEW</span><h2>結算預覽</h2></div>
        {autofillLoading && previewItems.length === 0 ? <div className="billing-empty"><strong>正在整理待結算銷貨…</strong><span>只會抓尚未被其他結算使用的庫存異動。</span></div> : previewItems.length === 0 ? <div className="billing-empty"><strong>目前沒有待結算品項</strong><span>若是沒有對應庫存銷貨的例外請款，可以手動新增商品與數量。</span></div> : <>
          <div className="billing-preview-meta"><span>{previewItems.length} 個 SKU</span>{autoSettlement ? <span>{autofillSourceCount} 筆待結算銷貨</span> : <span>手動請款</span>}<span>{autoSettlement ? "建立後鎖定來源" : "無庫存來源連結"}</span></div>
          <div className="table-wrap billing-items"><table><thead><tr><th>SKU</th><th>品項</th><th>售價</th><th>結算價</th><th>數量</th><th>小計</th></tr></thead><tbody>{previewItems.map((item) => <tr key={item.product.id}><td className="mono">{item.product.sku}</td><td>{item.product.name}{item.product.size ? ` · ${item.product.size}` : ""}</td><td>{item.product.listPrice == null ? "未設定" : money(item.listPrice)}</td><td>{item.product.listPrice == null ? "—" : money(item.settlementPrice)}</td><td>{item.quantity}</td><td>{item.product.listPrice == null ? "—" : money(item.subtotal)}</td></tr>)}</tbody></table></div>
          {hasMissingPrice && <div className="form-error billing-preview-error">有商品尚未設定建議售價，請先補上售價。</div>}
          <div className="billing-total-box">
            <div><span>未稅金額</span><strong>{money(subtotal)}</strong></div><div><span>營業稅</span><strong>{money(taxAmount)}</strong></div><div><span>運費</span><strong>{money(Number.isFinite(shipping) ? shipping : 0)}</strong></div>
            <div className="grand"><span>請款總額</span><strong>{money(totalAmount)}</strong></div>
          </div>
          <button className="btn btn-primary billing-create-button" disabled={saving || !canCreate} onClick={createStatement}>{saving ? "建立中…" : autoSettlement ? "確認並建立結算" : "建立手動請款"}</button>
        </>}
      </div>
    </section>}

    <section className="billing-list-section">
      <div className="billing-list-head"><div><span>03 / HISTORY</span><h2>請款 / 結算紀錄</h2></div><label className="billing-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋請款單號 / 客戶" /></label></div>
      <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>請款單號</th><th>客戶</th><th>結算期間</th><th>請款金額</th><th>狀態</th><th>請款日期</th><th></th></tr></thead><tbody>{filteredStatements.map((statement) => <tr key={statement.id}><td className="mono">{statement.statementNo}</td><td><strong>{statement.companyName}</strong><small className="billing-channel-name">{statement.channelName}</small></td><td>{statement.periodStart} → {statement.periodEnd}</td><td>{money(statement.totalAmount)}</td><td><span className={`badge billing-status-${statement.status.toLowerCase()}`}>{statusLabels[statement.status]}</span></td><td>{statement.issuedAt}</td><td><Link className="btn btn-secondary" href={`/billing/${statement.id}`}>查看</Link></td></tr>)}</tbody></table></div>{filteredStatements.length === 0 && <div className="billing-empty-row">目前沒有符合條件的請款單。</div>}</div>
    </section>
  </div>;
}
