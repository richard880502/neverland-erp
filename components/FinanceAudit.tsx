"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
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

type Detail = {
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
  source: string;
  sourceRef: string | null;
  note: string | null;
  legacySheet: string | null;
  legacyRow: number | null;
  items: Array<{
    id: string;
    productId: string | null;
    sku: string | null;
    productName: string;
    size: string | null;
    quantity: number;
    unitAmount: number | null;
    lineAmount: number;
    unitCostSnapshot: number | null;
  }>;
  invoices: Array<{
    id: string;
    invoiceNo: string | null;
    status: string;
    grossAmount: number | null;
    netAmount: number | null;
    taxAmount: number | null;
    issuedAt: string | null;
    note: string | null;
  }>;
  related: Array<{
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
  }>;
};

const paymentLabels: Record<string, string> = { PENDING: "待付款/收款", PARTIAL: "部分完成", PAID: "已付款/入帳", REFUNDED: "已退款", VOID: "已作廢" };
const reconcileLabels: Record<string, string> = { UNMATCHED: "未對帳", MATCHED: "已配對", RECONCILED: "已對帳" };
const invoiceLabels: Record<string, string> = { MISSING: "待補發票", RECEIVED: "已取得", VOIDED: "已作廢", CREDITED: "折讓", NOT_REQUIRED: "不需發票" };

function money(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
}

function displayDate(value: string | null) {
  if (!value) return "—";
  return value.slice(0, 10);
}

export function FinanceAudit({ transactions, canWrite }: { transactions: Transaction[]; canWrite: boolean }) {
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState("ALL");
  const [invoiceFilter, setInvoiceFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState("MISSING");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceIssuedAt, setInvoiceIssuedAt] = useState("");
  const [invoiceGrossAmount, setInvoiceGrossAmount] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-Hant");
    return transactions.filter((item) => {
      if (direction !== "ALL" && item.direction !== direction) return false;
      if (invoiceFilter !== "ALL" && item.invoiceStatus !== invoiceFilter) return false;
      if (!needle) return true;
      const haystack = [
        item.occurredAt,
        item.categoryName,
        item.categoryParentName,
        item.counterparty,
        item.relatedParty,
        item.salesChannel,
        item.summary,
        item.invoiceNo,
        ...item.productNames,
        String(item.amount),
      ].filter(Boolean).join(" ").toLocaleLowerCase("zh-Hant");
      return haystack.includes(needle);
    });
  }, [transactions, query, direction, invoiceFilter]);

  async function openDetail(id: string) {
    setSelectedId(id);
    setLoading(true);
    setMessage("");
    const response = await fetch(`/api/finance/transactions/${id}`);
    const result = await response.json();
    setLoading(false);
    if (!response.ok) {
      setMessage(result.error ?? "讀取交易失敗");
      return;
    }
    setDetail(result);
    const invoice = result.invoices?.[0];
    setInvoiceStatus(result.invoiceStatus ?? "MISSING");
    setInvoiceNo(invoice?.invoiceNo ?? "");
    setInvoiceIssuedAt(invoice?.issuedAt ? String(invoice.issuedAt).slice(0, 10) : "");
    setInvoiceGrossAmount(invoice?.grossAmount != null ? String(invoice.grossAmount) : String(result.amount ?? ""));
  }

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    setMessage("");
  }

  async function saveInvoice() {
    if (!detail || detail.direction !== "EXPENSE") return;
    setMessage("");
    const payload: Record<string, unknown> = { invoiceStatus };
    if (invoiceStatus === "RECEIVED") {
      payload.invoice = {
        invoiceNo: invoiceNo || null,
        issuedAt: invoiceIssuedAt || null,
        grossAmount: Number(invoiceGrossAmount || detail.amount),
      };
    }
    const response = await fetch(`/api/finance/transactions/${detail.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error ?? "發票更新失敗");
    setMessage("發票狀態已更新");
    await openDetail(detail.id);
  }

  return <>
    <section className={styles.transactions}>
      <div className={styles.sectionHead}>
        <div><span>06 / AUDIT LEDGER</span><h2>查帳</h2></div>
        <small>{filtered.length} / {transactions.length} 筆</small>
      </div>
      <div className={`panel ${styles.auditPanel}`}>
        <div className={styles.auditFilters}>
          <label className={styles.searchBox}><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋商品、店家、用途、發票號碼、金額…" /></label>
          <select className="select" value={direction} onChange={(event) => setDirection(event.target.value)}>
            <option value="ALL">全部收支</option>
            <option value="INCOME">收入</option>
            <option value="EXPENSE">支出</option>
          </select>
          <select className="select" value={invoiceFilter} onChange={(event) => setInvoiceFilter(event.target.value)}>
            <option value="ALL">全部發票狀態</option>
            <option value="MISSING">待補發票</option>
            <option value="RECEIVED">已取得發票</option>
            <option value="NOT_REQUIRED">不需發票</option>
            <option value="VOIDED">發票作廢</option>
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>日期</th><th>類型</th><th>分類 / 通路</th><th>對象</th><th>商品 / 用途</th><th>金額</th><th>發票</th><th>來源</th></tr></thead>
            <tbody>{filtered.map((item) => <tr key={item.id} className={styles.clickRow} onClick={() => void openDetail(item.id)}>
              <td className="mono">{item.occurredAt}</td>
              <td><span className={`${styles.direction} ${item.direction === "INCOME" ? styles.income : styles.expense}`}>{item.direction === "INCOME" ? "收入" : "支出"}</span></td>
              <td>{item.direction === "INCOME" ? item.salesChannel ?? item.categoryName ?? "未指定" : [item.categoryParentName, item.categoryName].filter(Boolean).join(" / ") || "未分類"}</td>
              <td>{item.counterparty ?? item.relatedParty ?? "—"}</td>
              <td><strong className={styles.auditSummary}>{item.productNames.join("、") || item.summary || "—"}</strong>{item.productNames.length > 0 && item.summary ? <small>{item.summary}</small> : null}</td>
              <td className={item.direction === "INCOME" ? styles.amountIncome : styles.amountExpense}>{item.direction === "INCOME" ? "+" : "-"}{money(item.amount)}</td>
              <td>{item.direction === "EXPENSE" ? invoiceLabels[item.invoiceStatus] ?? item.invoiceStatus : "—"}</td>
              <td>{item.source}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {!filtered.length && <div className={styles.empty}>找不到符合條件的交易。</div>}
      </div>
    </section>

    {selectedId && <div className={styles.drawerBackdrop} onClick={closeDetail}>
      <aside className={styles.drawer} onClick={(event) => event.stopPropagation()}>
        <div className={styles.drawerHead}><div><span>TRANSACTION DETAIL</span><h2>{detail?.summary || "交易明細"}</h2></div><button type="button" onClick={closeDetail} aria-label="關閉"><X size={18} /></button></div>
        {loading && <div className={styles.empty}>讀取中…</div>}
        {message && <p className={styles.formMessage}>{message}</p>}
        {detail && <div className={styles.drawerBody}>
          <section className={styles.detailHero}>
            <span>{displayDate(detail.occurredAt)} · {detail.direction === "INCOME" ? "收入" : "支出"}</span>
            <strong className={detail.direction === "INCOME" ? styles.amountIncome : styles.amountExpense}>{detail.direction === "INCOME" ? "+" : "-"}{money(detail.amount)}</strong>
            <p>{detail.direction === "INCOME" ? detail.salesChannel ?? "未指定通路" : [detail.categoryParentName, detail.categoryName].filter(Boolean).join(" / ") || "未分類"}</p>
          </section>

          <section className={styles.detailSection}><h3>對應資訊</h3><dl>
            <div><dt>付款 / 收款對象</dt><dd>{detail.counterparty ?? "—"}</dd></div>
            <div><dt>關聯店家 / 對象</dt><dd>{detail.relatedParty ?? "—"}</dd></div>
            <div><dt>付款狀態</dt><dd>{paymentLabels[detail.paymentStatus] ?? detail.paymentStatus}</dd></div>
            <div><dt>對帳狀態</dt><dd>{reconcileLabels[detail.reconciliationStatus] ?? detail.reconciliationStatus}</dd></div>
            <div><dt>來源</dt><dd>{detail.source}{detail.legacySheet ? ` · ${detail.legacySheet} #${detail.legacyRow}` : ""}</dd></div>
            <div><dt>備註</dt><dd>{detail.note ?? "—"}</dd></div>
          </dl></section>

          <section className={styles.detailSection}><h3>商品</h3>{detail.items.length ? <div className={styles.detailItems}>{detail.items.map((item) => <div key={item.id}>
            <span><strong>{item.productName}</strong><small>{[item.sku, item.size, `${item.quantity} 件`].filter(Boolean).join(" · ")}</small></span>
            <span>{money(item.lineAmount)}<small>{item.unitCostSnapshot != null ? `成本快照 ${money(item.unitCostSnapshot)} / 件` : "尚無成本資料"}</small></span>
          </div>)}</div> : <p className={styles.emptyInline}>這筆交易沒有關聯商品。</p>}</section>

          {detail.direction === "EXPENSE" && <section className={styles.detailSection}><h3>支出發票 / 憑證</h3>
            <div className={styles.invoiceEditor}>
              <div className="field"><label>狀態</label><select className="select" disabled={!canWrite} value={invoiceStatus} onChange={(event) => setInvoiceStatus(event.target.value)}><option value="MISSING">待補發票</option><option value="RECEIVED">已取得</option><option value="NOT_REQUIRED">不需發票</option><option value="VOIDED">已作廢</option><option value="CREDITED">折讓</option></select></div>
              {invoiceStatus === "RECEIVED" && <>
                <div className="field"><label>發票號碼</label><input className="input" disabled={!canWrite} value={invoiceNo} onChange={(event) => setInvoiceNo(event.target.value)} /></div>
                <div className="field"><label>發票日期</label><input className="input" type="date" disabled={!canWrite} value={invoiceIssuedAt} onChange={(event) => setInvoiceIssuedAt(event.target.value)} /></div>
                <div className="field"><label>含稅金額</label><input className="input" type="number" disabled={!canWrite} value={invoiceGrossAmount} onChange={(event) => setInvoiceGrossAmount(event.target.value)} /></div>
              </>}
              {canWrite && <button type="button" className="btn btn-secondary" onClick={() => void saveInvoice()}>儲存發票資訊</button>}
            </div>
          </section>}

          <section className={styles.detailSection}><h3>相關紀錄</h3>{detail.related.length ? <div className={styles.relatedList}>{detail.related.map((item) => <button type="button" key={item.id} onClick={() => void openDetail(item.id)}>
            <span>{displayDate(item.occurredAt)} · {item.summary ?? item.categoryName ?? item.salesChannel ?? "交易"}</span><strong>{item.direction === "INCOME" ? "+" : "-"}{money(item.amount)}</strong>
          </button>)}</div> : <p className={styles.emptyInline}>目前沒有找到同商品或同對象的其他交易。</p>}</section>
        </div>}
      </aside>
    </div>}
  </>;
}
