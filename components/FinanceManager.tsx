"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Plus, RefreshCw, Upload } from "lucide-react";
import { FinanceAudit } from "@/components/FinanceAudit";
import styles from "@/app/(erp)/finance/finance.module.css";

type Transaction = {
  id: string;
  occurredAt: string;
  direction: "INCOME" | "EXPENSE";
  amount: number;
  categoryName: string | null;
  categoryParentName: string | null;
  counterparty: string | null;
  relatedParty: string | null;
  salesChannel: string | null;
  summary: string | null;
  paymentStatus: string;
  reconciliationStatus: string;
  invoiceStatus: string;
  invoiceNo: string | null;
  productNames: string[];
  source: string;
};
type Category = { id: string; code: string; name: string; direction: "INCOME" | "EXPENSE"; parentId: string | null; parentName: string | null };
type Product = { id: string; sku: string; name: string; size: string | null };
type Channel = { id: string; name: string; type: string };
type Dashboard = {
  income: number;
  expense: number;
  cashFlow: number;
  receivable: number;
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
  cogs: number;
  inventorySpend: number;
  operatingExpense: number;
  grossProfit: number;
  estimatedNetProfit: number;
  profitMargin: number;
  costCoverage: number;
  missingExpenseInvoices: number;
  topProducts: Array<{ productId: string | null; productName: string; revenue: number; quantity: number }>;
  topCategories: Array<{ name: string; amount: number }>;
  topChannels: Array<{ name: string; amount: number }>;
};
type ImportRow = {
  sheetName: string;
  rowNumber: number;
  status: "READY" | "REVIEW" | "REJECTED";
  reason: string | null;
  normalized: {
    occurredAt: string | null;
    direction: "INCOME" | "EXPENSE" | null;
    amount: number | null;
    categoryCode: string | null;
    salesChannel?: string | null;
    counterparty?: string | null;
    relatedParty?: string | null;
    summary?: string | null;
    note?: string | null;
    items: Array<{ productName: string; size?: string | null; quantity: number; lineAmount: number }>;
  };
};
type ImportPreview = { batchId: string; summary: { total: number; READY: number; REVIEW: number; REJECTED: number }; rows: ImportRow[] };

const salesChannelOptions = ["蝦皮", "官網", "經銷", "親友", "IG", "其他"];
const periodOptions = [
  ["this-month", "本月"],
  ["last-month", "上個月"],
  ["3m", "近 3 個月"],
  ["6m", "近 6 個月"],
  ["12m", "近 12 個月"],
  ["24m", "近 24 個月"],
  ["this-year", "今年"],
  ["last-year", "去年"],
] as const;

function money(value: number) { return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value); }
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function percent(value: number) { return `${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 }).format(value)}%`; }

export function FinanceManager({ period, periodLabel, startDate, endDate, canWrite, transactions, categories, products, channels, dashboard }: {
  period: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  canWrite: boolean;
  transactions: Transaction[];
  categories: Category[];
  products: Product[];
  channels: Channel[];
  dashboard: Dashboard;
}) {
  const router = useRouter();
  const [direction, setDirection] = useState<"INCOME" | "EXPENSE">("INCOME");
  const [occurredAt, setOccurredAt] = useState(today());
  const [amount, setAmount] = useState("");
  const [parentCategoryId, setParentCategoryId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [salesChannel, setSalesChannel] = useState("蝦皮");
  const [counterparty, setCounterparty] = useState("");
  const [relatedParty, setRelatedParty] = useState("");
  const [summary, setSummary] = useState("");
  const [note, setNote] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [expenseInvoiceStatus, setExpenseInvoiceStatus] = useState<"MISSING" | "RECEIVED" | "NOT_REQUIRED">("MISSING");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importMessage, setImportMessage] = useState("");

  const expenseParents = categories.filter((category) => category.direction === "EXPENSE" && !category.parentId && categories.some((child) => child.parentId === category.id));
  const expenseChildren = categories.filter((category) => category.direction === "EXPENSE" && category.parentId === parentCategoryId);
  const selectedProduct = products.find((product) => product.id === productId) ?? null;
  const readyRows = preview?.rows.filter((row) => row.status === "READY") ?? [];

  const topRevenueMax = useMemo(() => Math.max(1, ...dashboard.topProducts.map((item) => item.revenue)), [dashboard.topProducts]);
  const topExpenseMax = useMemo(() => Math.max(1, ...dashboard.topCategories.map((item) => item.amount)), [dashboard.topCategories]);
  const topChannelMax = useMemo(() => Math.max(1, ...dashboard.topChannels.map((item) => item.amount)), [dashboard.topChannels]);
  const profitable = dashboard.estimatedNetProfit >= 0;
  const periodSpan = `${startDate} ～ ${endDate}`;

  function goToPreset(nextPeriod: string) {
    router.push(`/finance?period=${encodeURIComponent(nextPeriod)}`);
  }

  function openCustomRange() {
    router.push(`/finance?period=custom&start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`);
  }

  function applyCustomRange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextStart = String(form.get("start") ?? "");
    const nextEnd = String(form.get("end") ?? "");
    if (!nextStart || !nextEnd) return alert("請選擇開始與結束日期");
    if (nextStart > nextEnd) return alert("開始日期不能晚於結束日期");
    router.push(`/finance?period=custom&start=${encodeURIComponent(nextStart)}&end=${encodeURIComponent(nextEnd)}`);
  }

  function changeDirection(next: "INCOME" | "EXPENSE") {
    setDirection(next);
    setParentCategoryId("");
    setCategoryId("");
    setCounterparty("");
    setRelatedParty("");
    setSummary("");
    setExpenseInvoiceStatus("MISSING");
    setInvoiceNo("");
    setInvoiceDate(occurredAt || today());
    setMessage("");
  }

  function changeExpenseParent(id: string) {
    setParentCategoryId(id);
    setCategoryId("");
  }

  async function createTransaction() {
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) return setMessage("請輸入有效金額");
    if (direction === "INCOME" && !salesChannel.trim()) return setMessage("請選擇或輸入收入通路");
    if (direction === "EXPENSE" && !categoryId) return setMessage("請選擇支出大類與細項");

    const autoIncomeCategory = direction === "INCOME"
      ? categories.find((category) => category.code === (salesChannel === "經銷" ? "wholesale" : "sales"))?.id ?? null
      : categoryId;
    setSaving(true);
    setMessage("");
    const item = selectedProduct ? [{
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      sku: selectedProduct.sku,
      size: selectedProduct.size,
      quantity: Number(quantity || 1),
      lineAmount: numericAmount,
    }] : [];
    const invoiceStatus = direction === "EXPENSE" ? expenseInvoiceStatus : "NOT_REQUIRED";
    const response = await fetch("/api/finance/transactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        occurredAt,
        direction,
        amount: numericAmount,
        categoryId: autoIncomeCategory,
        salesChannel: direction === "INCOME" ? salesChannel || null : null,
        counterparty: counterparty || null,
        relatedParty: direction === "EXPENSE" ? relatedParty || null : null,
        summary: summary || null,
        note: note || null,
        paymentStatus: "PAID",
        reconciliationStatus: "UNMATCHED",
        invoiceStatus,
        invoice: direction === "EXPENSE" && expenseInvoiceStatus === "RECEIVED" ? {
          invoiceNo: invoiceNo || null,
          issuedAt: invoiceDate || occurredAt,
          grossAmount: numericAmount,
        } : null,
        source: "MANUAL",
        items: item,
      }),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setMessage(result.error ?? "新增失敗");
    setAmount("");
    setCounterparty("");
    setRelatedParty("");
    setSummary("");
    setNote("");
    setProductId("");
    setQuantity("1");
    setExpenseInvoiceStatus("MISSING");
    setInvoiceNo("");
    setMessage("已新增收支紀錄");
    router.refresh();
  }

  async function previewFile(file: File) {
    setImportLoading(true);
    setImportMessage("");
    setPreview(null);
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/finance/import/preview", { method: "POST", body: form });
    const result = await response.json();
    setImportLoading(false);
    if (!response.ok) return setImportMessage(result.error ?? "Excel 分析失敗");
    setPreview(result);
    setImportMessage(`已分析 ${result.summary.total} 筆；${result.summary.READY} 筆可直接匯入，${result.summary.REVIEW} 筆需要確認。`);
  }

  async function commitImport() {
    if (!preview?.batchId || !readyRows.length) return;
    setImportLoading(true);
    setImportMessage("");
    const response = await fetch("/api/finance/import/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId: preview.batchId }) });
    const result = await response.json();
    setImportLoading(false);
    if (!response.ok && response.status !== 207) return setImportMessage(result.error ?? "匯入失敗");
    setImportMessage(`已匯入 ${result.imported} 筆，略過 ${result.skipped} 筆${result.productLinks ? `，成功關聯 ${result.productLinks} 個商品明細` : ""}${result.errors?.length ? `，${result.errors.length} 筆失敗` : ""}。`);
    router.refresh();
  }

  return <div className={styles.page}>
    <datalist id="finance-sales-channels">{salesChannelOptions.map((name) => <option value={name} key={name} />)}</datalist>
    <datalist id="finance-parties">{channels.map((channel) => <option value={channel.name} key={channel.id} />)}</datalist>

    <form className={styles.toolbar} key={`${period}-${startDate}-${endDate}`} onSubmit={applyCustomRange}>
      <label>統計期間 <select className="select" value={period === "custom" ? "" : period} onChange={(event) => goToPreset(event.target.value)}><option value="" disabled>快捷區間</option>{periodOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <button className={period === "custom" ? "btn btn-primary" : "btn btn-secondary"} type="button" onClick={openCustomRange}>自訂區間</button>
      {period === "custom" && <>
        <label>開始日期 <input className="input" name="start" type="date" defaultValue={startDate} /></label>
        <label>結束日期 <input className="input" name="end" type="date" defaultValue={endDate} /></label>
        <button className="btn btn-primary" type="submit">套用</button>
      </>}
      <button className="btn btn-secondary" type="button" onClick={() => router.refresh()}><RefreshCw size={14} />重新整理</button>
    </form>

    <section className={styles.kpis}>
      <article><span>{periodLabel}淨營收</span><strong>{money(dashboard.netRevenue)}</strong><small>NET REVENUE</small></article>
      <article className={profitable ? styles.profitPositive : styles.profitNegative}><span>{periodLabel}估算淨利</span><strong>{profitable ? "+" : ""}{money(dashboard.estimatedNetProfit)}</strong><small>{profitable ? "賺錢" : "賠錢"} · 淨利率 {percent(dashboard.profitMargin)}</small></article>
      <article><span>{periodLabel}淨現金流</span><strong>{money(dashboard.cashFlow)}</strong><small>CASH FLOW</small></article>
      <article><span>{periodLabel}待補支出發票</span><strong>{dashboard.missingExpenseInvoices} 筆</strong><small>EXPENSE RECEIPTS</small></article>
    </section>

    <section className={`panel ${styles.profitPanel}`}>
      <div className={styles.sectionHead}><div><span>00 / PROFIT & LOSS</span><h2>{periodLabel}損益</h2><small>{periodSpan}</small></div><strong className={profitable ? styles.profitTextPositive : styles.profitTextNegative}>{profitable ? "賺錢" : "賠錢"}</strong></div>
      <div className={styles.profitLayout}>
        <div className={styles.profitStatement}>
          <div><span>銷售收入</span><strong>{money(dashboard.grossRevenue)}</strong></div>
          <div><span>退款 / 已退款收入</span><strong>-{money(dashboard.refunds)}</strong></div>
          <div className={styles.profitSubtotal}><span>淨營收</span><strong>{money(dashboard.netRevenue)}</strong></div>
          <div><span>已售商品成本 COGS</span><strong>-{money(dashboard.cogs)}</strong></div>
          <div className={styles.profitSubtotal}><span>毛利</span><strong>{money(dashboard.grossProfit)}</strong></div>
          <div><span>營運費用</span><strong>-{money(dashboard.operatingExpense)}</strong></div>
          <div className={styles.profitTotal}><span>估算淨利</span><strong>{profitable ? "+" : ""}{money(dashboard.estimatedNetProfit)}</strong></div>
        </div>
        <div className={styles.profitNotes}>
          <div><span>淨利率</span><strong>{percent(dashboard.profitMargin)}</strong></div>
          <div><span>商品成本覆蓋率</span><strong>{percent(dashboard.costCoverage)}</strong></div>
          <div><span>{periodLabel}進貨 / 製作現金支出</span><strong>{money(dashboard.inventorySpend)}</strong></div>
          <div><span>未收帳款</span><strong>{money(dashboard.receivable)}</strong></div>
          <p>{dashboard.costCoverage < 95 ? "目前仍有部分銷售沒有對應商品成本，淨利屬估算值；把商品成本補齊後會更準。" : "商品成本資料覆蓋良好；損益會依交易當下的成本快照計算。"}</p>
        </div>
      </div>
    </section>

    <section className={styles.grid}>
      {canWrite && <div className={`panel ${styles.panel}`}>
        <div className={styles.sectionHead}><div><span>01 / QUICK ENTRY</span><h2>快速記帳</h2></div><Plus size={17} /></div>
        <div className={styles.segmented}>
          <button type="button" className={direction === "INCOME" ? styles.active : ""} onClick={() => changeDirection("INCOME")}>收入</button>
          <button type="button" className={direction === "EXPENSE" ? styles.active : ""} onClick={() => changeDirection("EXPENSE")}>支出</button>
        </div>
        {message && <p className={styles.formMessage}>{message}</p>}
        <div className={styles.formGrid}>
          <div className="field"><label>日期</label><input className="input" type="date" value={occurredAt} onChange={(e) => { setOccurredAt(e.target.value); if (!invoiceDate) setInvoiceDate(e.target.value); }} /></div>
          <div className="field"><label>金額</label><input className="input" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="NT$" /></div>

          {direction === "INCOME" ? <>
            <div className="field"><label>收入通路</label><input className="input" list="finance-sales-channels" value={salesChannel} onChange={(e) => setSalesChannel(e.target.value)} placeholder="蝦皮 / 官網 / 經銷 / 親友…" /></div>
            <div className="field"><label>客戶 / 店家（選填）</label><input className="input" list="finance-parties" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="Chambers / Simon / 客戶名稱…" /></div>
          </> : <>
            <div className="field"><label>支出大類</label><select className="select" value={parentCategoryId} onChange={(e) => changeExpenseParent(e.target.value)}><option value="">選擇大類</option>{expenseParents.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
            <div className="field"><label>支出細項</label><select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!parentCategoryId}><option value="">選擇細項</option>{expenseChildren.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
            <div className="field"><label>付款對象（選填）</label><input className="input" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="奎斯特 / 7-11 / 郵局…" /></div>
            <div className="field"><label>關聯店家 / 對象（選填）</label><input className="input" list="finance-parties" value={relatedParty} onChange={(e) => setRelatedParty(e.target.value)} placeholder="Simon / Chambers / 公關對象…" /></div>
          </>}

          <div className="field"><label>關聯商品（選填）</label><select className="select" value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">不指定商品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}{p.size ? ` · ${p.size}` : ""}</option>)}</select></div>
          <div className="field"><label>數量</label><input className="input" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} disabled={!productId} /></div>

          {direction === "EXPENSE" && <>
            <div className="field"><label>發票 / 憑證</label><select className="select" value={expenseInvoiceStatus} onChange={(e) => setExpenseInvoiceStatus(e.target.value as "MISSING" | "RECEIVED" | "NOT_REQUIRED")}><option value="MISSING">待補發票</option><option value="RECEIVED">已取得</option><option value="NOT_REQUIRED">不需發票</option></select></div>
            {expenseInvoiceStatus === "RECEIVED" ? <div className="field"><label>發票號碼（選填）</label><input className="input" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="AB12345678" /></div> : <div />}
            {expenseInvoiceStatus === "RECEIVED" && <div className="field"><label>發票日期</label><input className="input" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>}
          </>}
        </div>
        <div className="field"><label>用途 / 摘要</label><input className="input" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={direction === "INCOME" ? "例如：7 月經銷銷售" : "例如：NeverLand Jersey 第一批製作"} /></div>
        <div className="field"><label>備註</label><textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="請款資訊、特殊狀況、補充說明…" /></div>
        <button className="btn btn-primary" disabled={saving} onClick={createTransaction}>{saving ? "儲存中…" : "新增交易"}</button>
      </div>}

      <div className={`panel ${styles.panel}`}>
        <div className={styles.sectionHead}><div><span>02 / PRODUCT REVENUE</span><h2>商品營收</h2></div></div>
        <div className={styles.rankList}>{dashboard.topProducts.length ? dashboard.topProducts.map((item, index) => <div key={`${item.productId}-${item.productName}`}><span className={styles.rank}>{String(index + 1).padStart(2,"0")}</span><span className={styles.rankName}>{item.productName}<small>{item.quantity} 件</small></span><span className={styles.bar}><i style={{ width: `${Math.max(4, item.revenue / topRevenueMax * 100)}%` }} /></span><strong>{money(item.revenue)}</strong></div>) : <p className={styles.empty}>這個區間還沒有商品收入資料。</p>}</div>
      </div>
    </section>

    <section className={styles.grid}>
      <div className={`panel ${styles.panel}`}>
        <div className={styles.sectionHead}><div><span>03 / EXPENSE STRUCTURE</span><h2>支出結構</h2></div></div>
        <div className={styles.rankList}>{dashboard.topCategories.length ? dashboard.topCategories.map((item, index) => <div key={item.name}><span className={styles.rank}>{String(index + 1).padStart(2,"0")}</span><span className={styles.rankName}>{item.name}</span><span className={styles.bar}><i style={{ width: `${Math.max(4, item.amount / topExpenseMax * 100)}%` }} /></span><strong>{money(item.amount)}</strong></div>) : <p className={styles.empty}>這個區間還沒有支出資料。</p>}</div>
      </div>
      <div className={`panel ${styles.panel}`}>
        <div className={styles.sectionHead}><div><span>04 / SALES CHANNELS</span><h2>收入通路</h2></div></div>
        <div className={styles.rankList}>{dashboard.topChannels.length ? dashboard.topChannels.map((item, index) => <div key={item.name}><span className={styles.rank}>{String(index + 1).padStart(2,"0")}</span><span className={styles.rankName}>{item.name}</span><span className={styles.bar}><i style={{ width: `${Math.max(4, item.amount / topChannelMax * 100)}%` }} /></span><strong>{money(item.amount)}</strong></div>) : <p className={styles.empty}>這個區間還沒有收入通路資料。</p>}</div>
      </div>
    </section>

    {canWrite && <section className={`panel ${styles.panel}`}>
      <div className={styles.sectionHead}><div><span>05 / LEGACY IMPORT</span><h2>Excel 舊資料整合</h2></div><FileSpreadsheet size={18} /></div>
      <div className={styles.importActions}><label className="btn btn-secondary"><Upload size={14} />{importLoading ? "處理中…" : "選擇 .xlsx"}<input hidden type="file" accept=".xlsx" disabled={importLoading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void previewFile(f); }} /></label>{preview && readyRows.length > 0 && <button className="btn btn-primary" disabled={importLoading} onClick={commitImport}>匯入 {readyRows.length} 筆 READY</button>}</div>
      {importMessage && <p className={styles.formMessage}>{importMessage}</p>}
      {preview && <><div className={styles.importStats}><span>總筆數 <strong>{preview.summary.total}</strong></span><span>可匯入 <strong>{preview.summary.READY}</strong></span><span>待確認 <strong>{preview.summary.REVIEW}</strong></span><span>拒絕 <strong>{preview.summary.REJECTED}</strong></span></div><div className="table-wrap"><table><thead><tr><th>來源</th><th>狀態</th><th>日期</th><th>方向</th><th>分類 / 通路</th><th>對象</th><th>用途 / 摘要</th><th>金額</th><th>原因</th></tr></thead><tbody>{preview.rows.slice(0,100).map((row) => <tr key={`${row.sheetName}-${row.rowNumber}`}><td>{row.sheetName} #{row.rowNumber}</td><td><span className="badge">{row.status}</span></td><td>{row.normalized.occurredAt ?? "—"}</td><td>{row.normalized.direction === "INCOME" ? "收入" : row.normalized.direction === "EXPENSE" ? "支出" : "—"}</td><td>{row.normalized.direction === "INCOME" ? row.normalized.salesChannel ?? "—" : row.normalized.categoryCode ?? "—"}</td><td>{row.normalized.counterparty ?? row.normalized.relatedParty ?? "—"}</td><td>{row.normalized.summary ?? "—"}</td><td>{row.normalized.amount ? money(row.normalized.amount) : "—"}</td><td>{row.reason ?? "—"}</td></tr>)}</tbody></table></div></>}
    </section>}

    <FinanceAudit transactions={transactions} canWrite={canWrite} />
  </div>;
}
