import { ArrowDownLeft, ArrowUpRight, CircleAlert, FileSpreadsheet, Plus, ReceiptText, WalletCards } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import styles from "./finance.module.css";

const transactions = [
  { date: "2026-08-27", direction: "income", category: "商品銷售", counterparty: "Shopee", amount: 2180, payment: "已入帳", reconcile: "已對帳" },
  { date: "2026-08-27", direction: "expense", category: "行銷 / 廣告", counterparty: "Meta", amount: 8000, payment: "已付款", reconcile: "待對帳" },
  { date: "2026-08-26", direction: "expense", category: "商品成本 / 製作費", counterparty: "奎斯特", amount: 20900, payment: "已付款", reconcile: "缺發票" },
  { date: "2026-08-25", direction: "income", category: "經銷收入", counterparty: "Zefeat", amount: 35200, payment: "待收款", reconcile: "未對帳" },
];

function money(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
}

export default function FinancePage() {
  return <div className={styles.page}>
    <PageHeader eyebrow="Finance / Prototype" title="財務工作台" description="第一版先驗證資訊架構：收支、應收應付、發票與對帳各自有獨立狀態，不修改商品生命週期狀態。" />

    <div className={styles.actions}>
      <button className="btn btn-primary" type="button"><Plus size={15} />新增交易</button>
      <button className="btn btn-secondary" type="button"><FileSpreadsheet size={15} />匯入 Excel / CSV</button>
    </div>

    <section className={styles.kpis}>
      <article><span>本月收入</span><strong>{money(328450)}</strong><small><ArrowUpRight size={13} /> INCOME</small></article>
      <article><span>本月支出</span><strong>{money(187320)}</strong><small><ArrowDownLeft size={13} /> EXPENSE</small></article>
      <article><span>淨現金流</span><strong>{money(141130)}</strong><small><WalletCards size={13} /> CASH FLOW</small></article>
      <article><span>未收帳款</span><strong>{money(82500)}</strong><small><ReceiptText size={13} /> RECEIVABLE</small></article>
    </section>

    <section className={styles.grid}>
      <div className={`panel ${styles.panel}`}>
        <div className={styles.sectionHead}><div><span>01 / ATTENTION</span><h2>待處理</h2></div></div>
        <div className={styles.alertList}>
          <button type="button"><CircleAlert size={16} /><span><strong>12 筆</strong>交易缺發票</span><em>查看</em></button>
          <button type="button"><CircleAlert size={16} /><span><strong>6 筆</strong>應收帳款已逾期</span><em>查看</em></button>
          <button type="button"><CircleAlert size={16} /><span><strong>17 筆</strong>銀行交易尚未對帳</span><em>查看</em></button>
          <button type="button"><CircleAlert size={16} /><span><strong>3 筆</strong>匯入資料待確認分類</span><em>查看</em></button>
        </div>
      </div>

      <div className={`panel ${styles.panel}`}>
        <div className={styles.sectionHead}><div><span>02 / IMPORT</span><h2>Excel 舊資料整合</h2></div><span className="badge">PROTOTYPE</span></div>
        <div className={styles.importFlow}>
          <div><span>1</span><strong>Parse</strong><small>保留 sheet / row</small></div>
          <b>→</b>
          <div><span>2</span><strong>Normalize</strong><small>收入、支出、分類</small></div>
          <b>→</b>
          <div><span>3</span><strong>Review</strong><small>人工確認模糊資料</small></div>
          <b>→</b>
          <div><span>4</span><strong>Import</strong><small>寫入 Finance Domain</small></div>
        </div>
        <p className={styles.note}>目前 Excel 只會被視為 legacy source。Finance 只引用既有商品、訂單與供應商，不會改動它們自己的狀態。</p>
      </div>
    </section>

    <section className={styles.transactions}>
      <div className={styles.sectionHead}>
        <div><span>03 / TRANSACTIONS</span><h2>最近收支</h2></div>
        <div className={styles.tabs}><button className={styles.active}>全部</button><button>收入</button><button>支出</button><button>待處理</button></div>
      </div>
      <div className="panel table-panel"><div className="table-wrap"><table>
        <thead><tr><th>日期</th><th>類型</th><th>分類</th><th>對象</th><th>金額</th><th>付款狀態</th><th>財務狀態</th></tr></thead>
        <tbody>{transactions.map((item, index) => <tr key={`${item.date}-${index}`}>
          <td className="mono">{item.date}</td>
          <td><span className={`${styles.direction} ${item.direction === "income" ? styles.income : styles.expense}`}>{item.direction === "income" ? "收入" : "支出"}</span></td>
          <td><strong>{item.category}</strong></td>
          <td>{item.counterparty}</td>
          <td className={item.direction === "income" ? styles.amountIncome : styles.amountExpense}>{item.direction === "income" ? "+" : "-"}{money(item.amount)}</td>
          <td><span className="badge">{item.payment}</span></td>
          <td>{item.reconcile}</td>
        </tr>)}</tbody>
      </table></div></div>
    </section>
  </div>;
}
