"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Plus, RefreshCw, Upload } from "lucide-react";
import styles from "@/app/(erp)/finance/finance.module.css";

type Transaction = { id: string; occurredAt: string; direction: "INCOME" | "EXPENSE"; amount: number; categoryName: string | null; counterparty: string | null; paymentStatus: string; reconciliationStatus: string; invoiceStatus: string; source: string };
type Category = { id: string; code: string; name: string; direction: "INCOME" | "EXPENSE" };
type Product = { id: string; sku: string; name: string; size: string | null };
type Dashboard = { income: number; expense: number; cashFlow: number; receivable: number; topProducts: Array<{ productId: string | null; productName: string; revenue: number; quantity: number }>; topCategories: Array<{ name: string; amount: number }> };
type ImportRow = { sheetName: string; rowNumber: number; status: "READY" | "REVIEW" | "REJECTED"; reason: string | null; normalized: { occurredAt: string | null; direction: "INCOME" | "EXPENSE" | null; amount: number | null; categoryCode: string | null; counterparty?: string | null; note?: string | null; items: Array<{ productName: string; size?: string | null; quantity: number; lineAmount: number }> } };
type ImportPreview = { batchId: string; summary: { total: number; READY: number; REVIEW: number; REJECTED: number }; rows: ImportRow[] };

const paymentLabels: Record<string, string> = { PENDING: "待付款/收款", PARTIAL: "部分完成", PAID: "已付款/入帳", REFUNDED: "已退款", VOID: "已作廢" };
const reconcileLabels: Record<string, string> = { UNMATCHED: "未對帳", MATCHED: "已配對", RECONCILED: "已對帳" };

function money(value: number) { return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value); }
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export function FinanceManager({ month, canWrite, transactions, categories, products, dashboard }: { month: string; canWrite: boolean; transactions: Transaction[]; categories: Category[]; products: Product[]; dashboard: Dashboard }) {
  const router = useRouter();
  const [direction, setDirection] = useState<"INCOME" | "EXPENSE">("INCOME");
  const [occurredAt, setOccurredAt] = useState(today());
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [note, setNote] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importMessage, setImportMessage] = useState("");

  const availableCategories = categories.filter((category) => category.direction === direction);
  const selectedProduct = products.find((product) => product.id === productId) ?? null;
  const readyRows = preview?.rows.filter((row) => row.status === "READY") ?? [];

  const topRevenueMax = useMemo(() => Math.max(1, ...dashboard.topProducts.map((item) => item.revenue)), [dashboard.topProducts]);

  function changeDirection(next: "INCOME" | "EXPENSE") { setDirection(next); setCategoryId(""); }

  async function createTransaction() {
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) return setMessage("請輸入有效金額");
    setSaving(true); setMessage("");
    const item = selectedProduct ? [{ productId: selectedProduct.id, productName: selectedProduct.name, sku: selectedProduct.sku, size: selectedProduct.size, quantity: Number(quantity || 1), lineAmount: numericAmount }] : [];
    const response = await fetch("/api/finance/transactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ occurredAt, direction, amount: numericAmount, categoryId: categoryId || null, counterparty: counterparty || null, note: note || null, paymentStatus: "PAID", reconciliationStatus: "UNMATCHED", invoiceStatus: "MISSING", source: "MANUAL", items: item }) });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return setMessage(result.error ?? "新增失敗");
    setAmount(""); setCounterparty(""); setNote(""); setProductId(""); setQuantity("1");
    setMessage("已新增收支紀錄"); router.refresh();
  }

  async function previewFile(file: File) {
    setImportLoading(true); setImportMessage(""); setPreview(null);
    const form = new FormData(); form.set("file", file);
    const response = await fetch("/api/finance/import/preview", { method: "POST", body: form });
    const result = await response.json();
    setImportLoading(false);
    if (!response.ok) return setImportMessage(result.error ?? "Excel 分析失敗");
    setPreview(result); setImportMessage(`已分析 ${result.summary.total} 筆；${result.summary.READY} 筆可直接匯入，${result.summary.REVIEW} 筆需要確認。`);
  }

  async function commitImport() {
    if (!preview?.batchId || !readyRows.length) return;
    setImportLoading(true); setImportMessage("");
    const response = await fetch("/api/finance/import/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId: preview.batchId }) });
    const result = await response.json();
    setImportLoading(false);
    if (!response.ok && response.status !== 207) return setImportMessage(result.error ?? "匯入失敗");
    setImportMessage(`已匯入 ${result.imported} 筆，略過 ${result.skipped} 筆${result.productLinks ? `，成功關聯 ${result.productLinks} 個商品明細` : ""}${result.errors?.length ? `，${result.errors.length} 筆失敗` : ""}。`);
    router.refresh();
  }

  return <div className={styles.page}>
    <div className={styles.toolbar}>
      <label>月份 <input className="input" type="month" value={month} onChange={(event) => router.push(`/finance?month=${event.target.value}`)} /></label>
      <button className="btn btn-secondary" type="button" onClick={() => router.refresh()}><RefreshCw size={14} />重新整理</button>
    </div>

    <section className={styles.kpis}>
      <article><span>本月收入</span><strong>{money(dashboard.income)}</strong><small>INCOME</small></article>
      <article><span>本月支出</span><strong>{money(dashboard.expense)}</strong><small>EXPENSE</small></article>
      <article><span>淨現金流</span><strong>{money(dashboard.cashFlow)}</strong><small>CASH FLOW</small></article>
      <article><span>未收帳款</span><strong>{money(dashboard.receivable)}</strong><small>RECEIVABLE</small></article>
    </section>

    <section className={styles.grid}>
      {canWrite && <div className={`panel ${styles.panel}`}>
        <div className={styles.sectionHead}><div><span>01 / QUICK ENTRY</span><h2>快速記帳</h2></div><Plus size={17} /></div>
        <div className={styles.segmented}><button className={direction === "INCOME" ? styles.active : ""} onClick={() => changeDirection("INCOME")}>收入</button><button className={direction === "EXPENSE" ? styles.active : ""} onClick={() => changeDirection("EXPENSE")}>支出</button></div>
        {message && <p className={styles.formMessage}>{message}</p>}
        <div className={styles.formGrid}>
          <div className="field"><label>日期</label><input className="input" type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} /></div>
          <div className="field"><label>金額</label><input className="input" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="NT$" /></div>
          <div className="field"><label>分類</label><select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">未分類</option>{availableCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="field"><label>交易對象</label><input className="input" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="Shopee / 奎斯特 / Meta…" /></div>
          <div className="field"><label>關聯商品（選填）</label><select className="select" value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">不指定商品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}{p.size ? ` · ${p.size}` : ""}</option>)}</select></div>
          <div className="field"><label>數量</label><input className="input" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} disabled={!productId} /></div>
        </div>
        <div className="field"><label>備註</label><textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button className="btn btn-primary" disabled={saving} onClick={createTransaction}>{saving ? "儲存中…" : "新增交易"}</button>
      </div>}

      <div className={`panel ${styles.panel}`}>
        <div className={styles.sectionHead}><div><span>02 / PRODUCT REVENUE</span><h2>商品營收</h2></div></div>
        <div className={styles.rankList}>{dashboard.topProducts.length ? dashboard.topProducts.map((item, index) => <div key={`${item.productId}-${item.productName}`}><span className={styles.rank}>{String(index + 1).padStart(2,"0")}</span><span className={styles.rankName}>{item.productName}<small>{item.quantity} 件</small></span><span className={styles.bar}><i style={{ width: `${Math.max(4, item.revenue / topRevenueMax * 100)}%` }} /></span><strong>{money(item.revenue)}</strong></div>) : <p className={styles.empty}>這個月份還沒有商品收入資料。</p>}</div>
      </div>
    </section>

    {canWrite && <section className={`panel ${styles.panel}`}>
      <div className={styles.sectionHead}><div><span>03 / LEGACY IMPORT</span><h2>Excel 舊資料整合</h2></div><FileSpreadsheet size={18} /></div>
      <div className={styles.importActions}><label className="btn btn-secondary"><Upload size={14} />{importLoading ? "處理中…" : "選擇 .xlsx"}<input hidden type="file" accept=".xlsx" disabled={importLoading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void previewFile(f); }} /></label>{preview && readyRows.length > 0 && <button className="btn btn-primary" disabled={importLoading} onClick={commitImport}>匯入 {readyRows.length} 筆 READY</button>}</div>
      {importMessage && <p className={styles.formMessage}>{importMessage}</p>}
      {preview && <><div className={styles.importStats}><span>總筆數 <strong>{preview.summary.total}</strong></span><span>可匯入 <strong>{preview.summary.READY}</strong></span><span>待確認 <strong>{preview.summary.REVIEW}</strong></span><span>拒絕 <strong>{preview.summary.REJECTED}</strong></span></div><div className="table-wrap"><table><thead><tr><th>來源</th><th>狀態</th><th>日期</th><th>方向</th><th>對象</th><th>金額</th><th>原因</th></tr></thead><tbody>{preview.rows.slice(0,100).map((row) => <tr key={`${row.sheetName}-${row.rowNumber}`}><td>{row.sheetName} #{row.rowNumber}</td><td><span className="badge">{row.status}</span></td><td>{row.normalized.occurredAt ?? "—"}</td><td>{row.normalized.direction === "INCOME" ? "收入" : row.normalized.direction === "EXPENSE" ? "支出" : "—"}</td><td>{row.normalized.counterparty ?? "—"}</td><td>{row.normalized.amount ? money(row.normalized.amount) : "—"}</td><td>{row.reason ?? "—"}</td></tr>)}</tbody></table></div></>}
    </section>}

    <section className={styles.transactions}>
      <div className={styles.sectionHead}><div><span>04 / TRANSACTIONS</span><h2>收支紀錄</h2></div></div>
      <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>日期</th><th>類型</th><th>分類</th><th>對象</th><th>金額</th><th>付款</th><th>對帳</th><th>發票</th><th>來源</th></tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td className="mono">{item.occurredAt}</td><td><span className={`${styles.direction} ${item.direction === "INCOME" ? styles.income : styles.expense}`}>{item.direction === "INCOME" ? "收入" : "支出"}</span></td><td>{item.categoryName ?? "未分類"}</td><td>{item.counterparty ?? "—"}</td><td className={item.direction === "INCOME" ? styles.amountIncome : styles.amountExpense}>{item.direction === "INCOME" ? "+" : "-"}{money(item.amount)}</td><td>{paymentLabels[item.paymentStatus] ?? item.paymentStatus}</td><td>{reconcileLabels[item.reconciliationStatus] ?? item.reconciliationStatus}</td><td>{item.invoiceStatus}</td><td>{item.source}</td></tr>)}</tbody></table></div>{!transactions.length && <div className={styles.empty}>這個月份還沒有收支資料。</div>}</div>
    </section>
  </div>;
}
