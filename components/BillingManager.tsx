"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Search, Store } from "lucide-react";
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

type Preview = {
  sourceMovementCount: number;
  alreadyBilledCount: number;
  items: Array<{ sku: string; productName: string; size: string | null; listPrice: number; settlementPrice: number; quantity: number; subtotal: number }>;
  subtotal: number;
  taxAmount: number;
  shippingFee: number;
  totalAmount: number;
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

export function BillingManager({
  channels,
  statements,
  canWrite,
  stats,
}: {
  channels: Channel[];
  statements: Statement[];
  canWrite: boolean;
  stats: { outstanding: number; paid: number; count: number };
}) {
  const router = useRouter();
  const range = useMemo(localMonthRange, []);
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [periodStart, setPeriodStart] = useState(range.start);
  const [periodEnd, setPeriodEnd] = useState(range.end);
  const [issuedAt, setIssuedAt] = useState(range.today);
  const [settlementPercent, setSettlementPercent] = useState("");
  const [taxPercent, setTaxPercent] = useState("5");
  const [shippingFee, setShippingFee] = useState("0");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const channel = channels.find((item) => item.id === channelId) ?? null;

  useEffect(() => {
    if (!channel) return;
    setSettlementPercent(channel.settlementRate == null ? "" : String(channel.settlementRate * 100));
    setTaxPercent(channel.taxRate == null ? "5" : String(channel.taxRate * 100));
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const settlement = Number(settlementPercent);
    const tax = Number(taxPercent);
    const shipping = Number(shippingFee || 0);
    if (!channelId || !periodStart || !periodEnd || !Number.isFinite(settlement) || settlement <= 0 || !Number.isFinite(tax) || !Number.isFinite(shipping)) {
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      setMessage("");
      const params = new URLSearchParams({
        channelId,
        periodStart,
        periodEnd,
        settlementRate: String(settlement / 100),
        taxRate: String(tax / 100),
        shippingFee: String(shipping),
      });
      try {
        const response = await fetch(`/api/billing/preview?${params}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) {
          setPreview(null);
          setMessage(result.error ?? "請款預覽失敗");
        } else {
          setPreview(result);
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") setMessage("請款預覽失敗");
      } finally {
        setPreviewLoading(false);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [channelId, periodStart, periodEnd, settlementPercent, taxPercent, shippingFee]);

  async function createStatement() {
    if (!preview || !channel) return;
    setSaving(true); setMessage("");
    const response = await fetch("/api/billing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channelId,
        periodStart,
        periodEnd,
        issuedAt,
        settlementRate: Number(settlementPercent) / 100,
        taxRate: Number(taxPercent) / 100,
        shippingFee: Number(shippingFee || 0),
        note: note || null,
      }),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setMessage(result.error ?? "請款單建立失敗");
    router.push(`/billing/${result.id}`);
    router.refresh();
  }

  const filteredStatements = statements.filter((statement) => {
    const needle = search.trim().toLowerCase();
    return !needle || statement.statementNo.toLowerCase().includes(needle) || statement.companyName.toLowerCase().includes(needle) || statement.channelName.toLowerCase().includes(needle);
  });

  return <div className="billing-page">
    <PageHeader eyebrow="Receivables" title="請款管理" description="從寄賣售出或買斷紀錄建立正式請款單，並輸出 Neverland 固定 XLSX / PDF 格式。" />

    <div className="billing-stats">
      <div><span>請款單</span><strong>{stats.count}</strong><small>STATEMENTS</small></div>
      <div><span>待收款</span><strong>{money(stats.outstanding)}</strong><small>OUTSTANDING</small></div>
      <div><span>已收款</span><strong>{money(stats.paid)}</strong><small>COLLECTED</small></div>
    </div>

    {canWrite && <section className="billing-create-grid">
      <div className="panel billing-form-panel">
        <div className="billing-section-head"><span>01 / SETUP</span><h2>建立請款單</h2></div>
        {message && <div className="form-error">{message}</div>}
        <div className="field"><label>客戶 / 通路</label><select className="select" value={channelId} onChange={(event) => setChannelId(event.target.value)}><option value="">選擇客戶</option>{channels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.type === "CONSIGNMENT" ? "寄賣" : "買斷"}</option>)}</select></div>
        {channel && <div className="billing-customer-card">
          <div><Store size={16} /><strong>{channel.companyName || channel.name}</strong></div>
          <dl>
            <div><dt>統編</dt><dd>{channel.taxId || "—"}</dd></div>
            <div><dt>聯絡人</dt><dd>{channel.contactName || "—"}</dd></div>
            <div><dt>電話</dt><dd>{channel.contactPhone || "—"}</dd></div>
            <div><dt>Email</dt><dd>{channel.contactEmail || "—"}</dd></div>
            <div className="wide"><dt>地址</dt><dd>{channel.billingAddress || "—"}</dd></div>
          </dl>
        </div>}
        <div className="billing-two-col">
          <div className="field"><label>結算起日</label><input className="input" type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></div>
          <div className="field"><label>結算迄日</label><input className="input" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></div>
          <div className="field"><label>請款日期</label><input className="input" type="date" value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} /></div>
          <div className="field"><label>結算比例 (%)</label><input className="input" type="number" min="0.01" max="100" step="0.01" placeholder="請先設定，例如 60" value={settlementPercent} onChange={(event) => setSettlementPercent(event.target.value)} /></div>
          <div className="field"><label>營業稅 (%)</label><input className="input" type="number" min="0" max="100" step="0.01" value={taxPercent} onChange={(event) => setTaxPercent(event.target.value)} /></div>
          <div className="field"><label>運費</label><input className="input" type="number" min="0" step="1" value={shippingFee} onChange={(event) => setShippingFee(event.target.value)} /></div>
        </div>
        <div className="field"><label>備註</label><textarea className="textarea" rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></div>
        {channel && channel.settlementRate == null && <p className="billing-hint">此客戶尚未設定預設結算比例；本次可直接輸入，之後建議到「通路主檔 → 請款設定」保存。</p>}
      </div>

      <div className="panel billing-preview-panel">
        <div className="billing-section-head"><span>02 / PREVIEW</span><h2>即時預覽</h2></div>
        {previewLoading && <div className="billing-empty">正在整理銷售紀錄…</div>}
        {!previewLoading && !preview && <div className="billing-empty"><FilePlus2 size={28} /><strong>選擇客戶與期間</strong><span>系統會自動抓尚未請款的寄賣售出 / 買斷紀錄。</span></div>}
        {!previewLoading && preview && <>
          <div className="billing-preview-meta"><span>{preview.sourceMovementCount} 筆銷售來源</span><span>{preview.items.length} 個 SKU</span>{preview.alreadyBilledCount > 0 && <span className="warn">另有 {preview.alreadyBilledCount} 筆已請款，自動排除</span>}</div>
          <div className="table-wrap billing-items"><table><thead><tr><th>SKU</th><th>品項</th><th>售價</th><th>結算價</th><th>數量</th><th>小計</th></tr></thead><tbody>{preview.items.map((item) => <tr key={item.sku}><td className="mono">{item.sku}</td><td>{item.productName}{item.size ? ` · ${item.size}` : ""}</td><td>{money(item.listPrice)}</td><td>{money(item.settlementPrice)}</td><td>{item.quantity}</td><td>{money(item.subtotal)}</td></tr>)}</tbody></table></div>
          <div className="billing-total-box">
            <div><span>未稅金額</span><strong>{money(preview.subtotal)}</strong></div>
            <div><span>營業稅</span><strong>{money(preview.taxAmount)}</strong></div>
            <div><span>運費</span><strong>{money(preview.shippingFee)}</strong></div>
            <div className="grand"><span>請款總額</span><strong>{money(preview.totalAmount)}</strong></div>
          </div>
          <button className="btn btn-primary billing-create-button" disabled={saving || preview.items.length === 0} onClick={createStatement}>{saving ? "建立中…" : "確認並建立請款單"}</button>
        </>}
      </div>
    </section>}

    <section className="billing-list-section">
      <div className="billing-list-head"><div><span>03 / HISTORY</span><h2>請款紀錄</h2></div><label className="billing-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋請款單號 / 客戶" /></label></div>
      <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>請款單號</th><th>客戶</th><th>結算期間</th><th>請款金額</th><th>狀態</th><th>請款日期</th><th></th></tr></thead><tbody>{filteredStatements.map((statement) => <tr key={statement.id}><td className="mono">{statement.statementNo}</td><td><strong>{statement.companyName}</strong><small className="billing-channel-name">{statement.channelName}</small></td><td>{statement.periodStart} → {statement.periodEnd}</td><td>{money(statement.totalAmount)}</td><td><span className={`badge billing-status-${statement.status.toLowerCase()}`}>{statusLabels[statement.status]}</span></td><td>{statement.issuedAt}</td><td><Link className="btn btn-secondary" href={`/billing/${statement.id}`}>查看</Link></td></tr>)}</tbody></table></div>{filteredStatements.length === 0 && <div className="billing-empty-row">目前沒有符合條件的請款單。</div>}</div>
    </section>
  </div>;
}
