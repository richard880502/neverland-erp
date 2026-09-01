"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

type SettlementCycle = "PER_ORDER" | "DAILY" | "WEEKLY" | "MONTHLY" | "PER_PAYOUT" | "MANUAL";
type BillingTrigger = "ORDER_COMPLETED" | "PAYOUT_RECEIVED" | "PAYMENT_RECEIVED" | "MANUAL";

type DirectChannel = {
  id: string;
  name: string;
  settlementCycle: SettlementCycle | null;
  billingTrigger: BillingTrigger | null;
  requiresSalesInvoice: boolean;
};

type ProductSummary = {
  productId: string;
  sku: string;
  productName: string;
  size: string | null;
  quantity: number;
  amount: number;
};

type Preview = {
  channel: { id: string; name: string; settlementCycle: SettlementCycle | null; billingTrigger: BillingTrigger | null };
  sourceMovementCount: number;
  sourceMovementIds: string[];
  salesMovementCount: number;
  returnMovementCount: number;
  grossSales: number;
  shippingIncome: number;
  shippingGroupCount: number;
  refundAmount: number;
  sales: ProductSummary[];
  returns: ProductSummary[];
};

type Settlement = {
  id: string;
  settlementNo: string;
  channelName: string;
  periodStart: string;
  periodEnd: string;
  settledAt: string;
  grossSales: number;
  shippingIncome: number;
  refundAmount: number;
  platformFee: number;
  paymentFee: number;
  otherFee: number;
  expectedPayout: number;
  actualPayout: number | null;
  discrepancy: number | null;
  status: "OPEN" | "RECONCILED" | "VOID";
};

type MergedProductRow = {
  productId: string;
  sku: string;
  name: string;
  salesQty: number;
  salesAmount: number;
  returnQty: number;
  returnAmount: number;
};

const cycleLabels: Record<SettlementCycle, string> = {
  PER_ORDER: "每筆訂單",
  DAILY: "每日結算",
  WEEKLY: "每週結算",
  MONTHLY: "每月結算",
  PER_PAYOUT: "平台 / 金流撥款批次",
  MANUAL: "手動結算",
};
const triggerLabels: Record<BillingTrigger, string> = {
  ORDER_COMPLETED: "訂單完成",
  PAYOUT_RECEIVED: "收到平台 / 金流撥款",
  PAYMENT_RECEIVED: "收到款項",
  MANUAL: "由人員確認",
};
const statusLabels = { OPEN: "待核對", RECONCILED: "已對帳", VOID: "已作廢" } as const;

function monthRange() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
    end: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())}`,
    today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  };
}

function money(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 2 }).format(value);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function mergeProductRows(preview: Preview | null): MergedProductRow[] {
  if (!preview) return [];
  const rows = new Map<string, MergedProductRow>();
  for (const item of preview.sales) {
    rows.set(item.productId, {
      productId: item.productId,
      sku: item.sku,
      name: `${item.productName}${item.size ? ` · ${item.size}` : ""}`,
      salesQty: item.quantity,
      salesAmount: item.amount,
      returnQty: 0,
      returnAmount: 0,
    });
  }
  for (const item of preview.returns) {
    const row = rows.get(item.productId) ?? {
      productId: item.productId,
      sku: item.sku,
      name: `${item.productName}${item.size ? ` · ${item.size}` : ""}`,
      salesQty: 0,
      salesAmount: 0,
      returnQty: 0,
      returnAmount: 0,
    };
    row.returnQty += item.quantity;
    row.returnAmount = roundMoney(row.returnAmount + item.amount);
    rows.set(item.productId, row);
  }
  return [...rows.values()].sort((a, b) => a.sku.localeCompare(b.sku, "zh-Hant", { numeric: true }));
}

export function DirectSettlementManager({ channels, settlements, canWrite }: { channels: DirectChannel[]; settlements: Settlement[]; canWrite: boolean }) {
  const router = useRouter();
  const initialRange = monthRange();
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [periodStart, setPeriodStart] = useState(initialRange.start);
  const [periodEnd, setPeriodEnd] = useState(initialRange.end);
  const [settledAt, setSettledAt] = useState(initialRange.today);
  const [platformFee, setPlatformFee] = useState("0");
  const [paymentFee, setPaymentFee] = useState("0");
  const [otherFee, setOtherFee] = useState("0");
  const [actualPayout, setActualPayout] = useState("");
  const [payoutReference, setPayoutReference] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);

  const channel = channels.find((item) => item.id === channelId) ?? null;
  const itemRows = mergeProductRows(preview);

  useEffect(() => {
    if (!channelId || !periodStart || !periodEnd || periodStart > periodEnd) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setMessage("");
      try {
        const params = new URLSearchParams({ channelId, periodStart, periodEnd });
        const response = await fetch(`/api/direct-settlements/preview?${params}`, { signal: controller.signal });
        const result = await response.json() as Preview & { error?: string };
        if (!response.ok) {
          setPreview(null);
          setMessage(result.error ?? "讀取直營待結算銷售失敗");
          return;
        }
        setPreview(result);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setMessage("讀取直營待結算銷售失敗");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [channelId, periodStart, periodEnd, version]);

  const fees = roundMoney(Number(platformFee || 0) + Number(paymentFee || 0) + Number(otherFee || 0));
  const expectedPayout = roundMoney((preview?.grossSales ?? 0) + (preview?.shippingIncome ?? 0) - (preview?.refundAmount ?? 0) - fees);
  const actual = actualPayout === "" ? null : Number(actualPayout);
  const discrepancy = actual === null || !Number.isFinite(actual) ? null : roundMoney(actual - expectedPayout);
  const canCreate = canWrite && Boolean(preview?.sourceMovementIds.length) && actual !== null && Number.isFinite(actual) && actual >= 0
    && [platformFee, paymentFee, otherFee].every((value) => Number.isFinite(Number(value || 0)) && Number(value || 0) >= 0)
    && !loading && !saving;

  async function createSettlement() {
    if (!canCreate || !preview || actual === null) return;
    setSaving(true); setMessage("");
    const response = await fetch("/api/direct-settlements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channelId,
        periodStart,
        periodEnd,
        settledAt,
        sourceMovementIds: preview.sourceMovementIds,
        platformFee: Number(platformFee || 0),
        paymentFee: Number(paymentFee || 0),
        otherFee: Number(otherFee || 0),
        actualPayout: actual,
        payoutReference: payoutReference || null,
        note: note || null,
      }),
    });
    const result = await response.json() as { error?: string };
    setSaving(false);
    if (!response.ok) return setMessage(result.error ?? "直營結算建立失敗");
    setPlatformFee("0"); setPaymentFee("0"); setOtherFee("0"); setActualPayout(""); setPayoutReference(""); setNote("");
    setVersion((value) => value + 1);
    router.refresh();
  }

  async function voidSettlement(id: string) {
    if (!confirm("確定作廢這筆直營結算？來源銷售會重新回到待結算，相關 Finance 紀錄會一起作廢。")) return;
    setMessage("");
    const response = await fetch(`/api/direct-settlements/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "VOID" }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) return setMessage(result.error ?? "作廢失敗");
    setVersion((value) => value + 1);
    router.refresh();
  }

  return <section className="billing-list-section">
    <div className="billing-list-head">
      <div><span>DIRECT SALES</span><h2>直營銷售 / 撥款結算</h2><p className="helper">官網、蝦皮等直營通路先彙總銷售與退貨，再用平台費、金流費與實際撥款完成對帳；淨撥款不會直接當成營收。</p></div>
    </div>

    {canWrite && <section className="billing-create-grid">
      <div className="panel billing-form-panel">
        <div className="billing-section-head"><span>01 / SOURCE</span><h2>待結算銷售</h2></div>
        {message && <div className="form-error">{message}</div>}
        <div className="field"><label>直營通路</label><select className="select" value={channelId} onChange={(event) => { setChannelId(event.target.value); setPreview(null); setActualPayout(""); }}><option value="">選擇通路</option>{channels.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div>
        {channel && <div className="billing-customer-card"><div><strong>{channel.name}</strong></div><dl><div><dt>結算方式</dt><dd>{channel.settlementCycle ? cycleLabels[channel.settlementCycle] : "未設定"}</dd></div><div><dt>對帳觸發</dt><dd>{channel.billingTrigger ? triggerLabels[channel.billingTrigger] : "未設定"}</dd></div><div><dt>銷項發票</dt><dd>{channel.requiresSalesInvoice ? "系統追蹤" : "依訂單 / 平台"}</dd></div></dl></div>}
        <div className="billing-two-col">
          <div className="field"><label>銷售期間起日</label><input className="input" type="date" value={periodStart} onChange={(event) => { setPeriodStart(event.target.value); setPreview(null); setActualPayout(""); }} /></div>
          <div className="field"><label>銷售期間迄日</label><input className="input" type="date" value={periodEnd} onChange={(event) => { setPeriodEnd(event.target.value); setPreview(null); setActualPayout(""); }} /></div>
          <div className="field"><label>撥款 / 入帳日期</label><input className="input" type="date" value={settledAt} onChange={(event) => setSettledAt(event.target.value)} /></div>
          <div className="field"><label>撥款 / 對帳單號</label><input className="input" value={payoutReference} onChange={(event) => setPayoutReference(event.target.value)} placeholder="平台撥款批次或銀行摘要" /></div>
        </div>
        <div className="billing-items-editor-head"><div><span>SOURCE MOVEMENTS</span><strong>{loading ? "整理中…" : preview ? `${preview.sourceMovementCount} 筆尚未結算銷售事件` : "尚未讀取"}</strong></div><button type="button" className="btn btn-secondary" disabled={loading || !channelId} onClick={() => setVersion((value) => value + 1)}><RefreshCw size={14} />重新整理</button></div>
        {preview && preview.sourceMovementCount > 0 && <p className="billing-hint">銷售 {preview.salesMovementCount} 筆、退貨 {preview.returnMovementCount} 筆；建立後會鎖定這些來源。資料不對請先修正庫存異動。</p>}
        {preview && preview.sourceMovementCount === 0 && <div className="billing-empty"><strong>這個期間沒有待結算直營銷售</strong><span>已結算過的 SHIP / SALES_RETURN 不會重複出現。</span></div>}
      </div>

      <div className="panel billing-preview-panel">
        <div className="billing-section-head"><span>02 / PAYOUT</span><h2>撥款對帳</h2></div>
        <div className="billing-total-box">
          <div><span>商品銷售</span><strong>{money(preview?.grossSales ?? 0)}</strong></div>
          <div><span>客戶負擔運費</span><strong>{money(preview?.shippingIncome ?? 0)}</strong></div>
          <div><span>退款 / 銷退</span><strong>- {money(preview?.refundAmount ?? 0)}</strong></div>
        </div>
        <div className="billing-three-col">
          <div className="field"><label>平台手續費</label><input className="input" type="number" min="0" step="0.01" value={platformFee} onChange={(event) => setPlatformFee(event.target.value)} /></div>
          <div className="field"><label>金流手續費</label><input className="input" type="number" min="0" step="0.01" value={paymentFee} onChange={(event) => setPaymentFee(event.target.value)} /></div>
          <div className="field"><label>其他平台扣款</label><input className="input" type="number" min="0" step="0.01" value={otherFee} onChange={(event) => setOtherFee(event.target.value)} /></div>
        </div>
        <div className="billing-total-box">
          <div><span>系統推算應撥</span><strong>{money(expectedPayout)}</strong></div>
          <div className="grand"><span>實際撥款 / 實收</span><strong>{actual === null || !Number.isFinite(actual) ? "尚未輸入" : money(actual)}</strong></div>
          <div><span>差異</span><strong>{discrepancy === null ? "—" : money(discrepancy)}</strong></div>
        </div>
        <div className="field"><label>實際撥款 / 實收金額</label><input className="input" type="number" min="0" step="0.01" value={actualPayout} onChange={(event) => setActualPayout(event.target.value)} placeholder="建立正式結算前必填" /></div>
        <div className="field"><label>備註</label><textarea className="textarea" rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></div>
        {discrepancy !== null && Math.abs(discrepancy) > 0.01 && <div className="form-error billing-preview-error">實際撥款與系統推算差 {money(discrepancy)}。可先補齊其他扣款後再建立；若仍建立，會保留為「待核對」。</div>}
        <button className="btn btn-primary billing-create-button" disabled={!canCreate} onClick={createSettlement}>{saving ? "建立中…" : "確認並建立撥款結算"}</button>
      </div>
    </section>}

    {itemRows.length > 0 && <div className="panel table-panel">
      <div className="billing-list-head"><div><span>ITEM SUMMARY</span><h3>本批商品彙總</h3></div></div>
      <div className="table-wrap"><table><thead><tr><th>SKU</th><th>商品</th><th>銷售數量</th><th>銷售額</th><th>退貨數量</th><th>退款額</th></tr></thead><tbody>{itemRows.map((row) => <tr key={row.productId}><td className="mono">{row.sku}</td><td>{row.name}</td><td>{row.salesQty}</td><td>{money(row.salesAmount)}</td><td>{row.returnQty}</td><td>{money(row.returnAmount)}</td></tr>)}</tbody></table></div>
    </div>}

    <div className="billing-list-head"><div><span>DIRECT HISTORY</span><h3>直營撥款結算紀錄</h3></div></div>
    <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>結算單號</th><th>通路</th><th>銷售期間</th><th>銷售</th><th>退款</th><th>費用</th><th>應撥 / 實撥</th><th>狀態</th>{canWrite && <th>操作</th>}</tr></thead><tbody>{settlements.map((item) => <tr key={item.id}><td className="mono">{item.settlementNo}</td><td>{item.channelName}</td><td>{item.periodStart} → {item.periodEnd}</td><td>{money(item.grossSales + item.shippingIncome)}</td><td>{money(item.refundAmount)}</td><td>{money(item.platformFee + item.paymentFee + item.otherFee)}</td><td><strong>{money(item.expectedPayout)}</strong><small className="billing-channel-name">實撥 {item.actualPayout == null ? "—" : money(item.actualPayout)}{item.discrepancy == null ? "" : ` · 差 ${money(item.discrepancy)}`}</small></td><td><span className={`badge ${item.status === "RECONCILED" ? "green" : ""}`}>{statusLabels[item.status]}</span></td>{canWrite && <td>{item.status === "OPEN" ? <button className="btn btn-danger" onClick={() => voidSettlement(item.id)}>作廢</button> : "—"}</td>}</tr>)}</tbody></table></div>{settlements.length === 0 && <div className="billing-empty-row">目前沒有直營撥款結算。</div>}</div>
  </section>;
}
