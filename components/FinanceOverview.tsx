"use client";

import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import styles from "@/app/(erp)/finance/finance-overview.module.css";

type TrendRow = {
  month: string;
  netRevenue: number;
  grossProfit: number;
  estimatedNetProfit: number;
  partial: boolean;
};

type Dashboard = {
  netRevenue: number;
  estimatedNetProfit: number;
  cashFlow: number;
  profitMargin: number;
  missingExpenseInvoices: number;
  trend: TrendRow[];
};

type Metric = "netRevenue" | "grossProfit" | "estimatedNetProfit";

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

const metricOptions: Array<[Metric, string]> = [
  ["netRevenue", "淨營收"],
  ["grossProfit", "毛利"],
  ["estimatedNetProfit", "估算淨利"],
];

function money(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
}

function compactMoney(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function percent(value: number) {
  return `${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 }).format(value)}%`;
}

function monthLabel(month: string) {
  const [year, mon] = month.split("-");
  return `${year.slice(2)}/${mon}`;
}

export function FinanceOverview({ period, periodLabel, startDate, endDate, dashboard }: {
  period: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  dashboard: Dashboard;
}) {
  const router = useRouter();
  const [metric, setMetric] = useState<Metric>("netRevenue");
  const profitable = dashboard.estimatedNetProfit >= 0;
  const values = useMemo(() => dashboard.trend.map((row) => row[metric]), [dashboard.trend, metric]);
  const maxPositive = Math.max(0, ...values);
  const minNegative = Math.min(0, ...values);
  const span = maxPositive - minNegative || 1;
  const zeroTop = maxPositive === 0 && minNegative === 0 ? 100 : maxPositive / span * 100;
  const compact = dashboard.trend.length > 12;
  const metricToneClass = metric === "netRevenue"
    ? styles.revenueMetric
    : metric === "grossProfit"
      ? styles.grossProfitMetric
      : styles.netProfitMetric;
  const chartStyle = { "--zero-top": `${zeroTop}%`, minWidth: `${Math.max(680, dashboard.trend.length * 68)}px` } as CSSProperties;

  function goToPreset(nextPeriod: string) {
    if (!nextPeriod || nextPeriod === "custom") return;
    router.push(`/finance?period=${encodeURIComponent(nextPeriod)}`);
  }

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const start = String(data.get("start") ?? "");
    const end = String(data.get("end") ?? "");
    if (!start || !end) return alert("請選擇開始與結束日期");
    if (start > end) return alert("開始日期不能晚於結束日期");
    router.push(`/finance?period=custom&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
  }

  return <div className={styles.overview}>
    <form className={styles.toolbar} onSubmit={applyRange}>
      <label>
        <span>統計期間</span>
        <select className="select" value={period === "custom" ? "custom" : period} onChange={(event) => goToPreset(event.target.value)}>
          {period === "custom" && <option value="custom">自訂日期</option>}
          {periodOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      <label>
        <span>開始日期</span>
        <input className="input" name="start" type="date" defaultValue={startDate} />
      </label>
      <span className={styles.rangeDivider}>～</span>
      <label>
        <span>結束日期</span>
        <input className="input" name="end" type="date" defaultValue={endDate} />
      </label>
      <button className="btn btn-primary" type="submit">套用</button>
      <button className="btn btn-secondary" type="button" onClick={() => router.refresh()}><RefreshCw size={16} />重新整理</button>
    </form>

    <section className={styles.kpis}>
      <article><span>{periodLabel}淨營收</span><strong>{money(dashboard.netRevenue)}</strong><small>NET REVENUE</small></article>
      <article className={profitable ? styles.profitPositive : styles.profitNegative}><span>{periodLabel}估算淨利</span><strong>{profitable ? "+" : ""}{money(dashboard.estimatedNetProfit)}</strong><small>{profitable ? "賺錢" : "賠錢"} · 淨利率 {percent(dashboard.profitMargin)}</small></article>
      <article><span>{periodLabel}淨現金流</span><strong>{money(dashboard.cashFlow)}</strong><small>CASH FLOW</small></article>
      <article><span>{periodLabel}待補支出發票</span><strong>{dashboard.missingExpenseInvoices} 筆</strong><small>EXPENSE RECEIPTS</small></article>
    </section>

    <section className={`${styles.trendPanel} ${metricToneClass}`}>
      <div className={styles.trendHead}>
        <div>
          <span>FINANCIAL TREND</span>
          <h2>財務趨勢</h2>
          <small>{startDate} ～ {endDate}</small>
        </div>
        <div className={styles.metricSwitch} aria-label="趨勢指標">
          {metricOptions.map(([value, label]) => <button key={value} type="button" className={metric === value ? styles.activeMetric : ""} onClick={() => setMetric(value)}>{label}</button>)}
        </div>
      </div>

      {dashboard.trend.length ? <div className={styles.trendScroll}>
        <div className={styles.trendChart} style={chartStyle}>
          {dashboard.trend.map((row) => {
            const value = row[metric];
            const height = Math.abs(value) / span * 100;
            const top = value >= 0 ? (maxPositive - value) / span * 100 : maxPositive / span * 100;
            return <div className={styles.monthColumn} key={row.month} title={`${row.month}${row.partial ? "（部分月份）" : ""} · ${money(value)}`}>
              <div className={styles.barPlot}>
                <i
                  className={`${styles.trendBar} ${value < 0 ? styles.negativeBar : styles.positiveBar}`}
                  style={{ top: `${top}%`, height: value === 0 ? "0" : `${Math.max(height, 1)}%` }}
                />
              </div>
              <div className={styles.monthMeta}>
                <strong>{monthLabel(row.month)}{row.partial ? <sup>*</sup> : null}</strong>
                {!compact && <small>{compactMoney(value)}</small>}
              </div>
            </div>;
          })}
        </div>
      </div> : <p className={styles.empty}>這個區間還沒有可繪製的財務資料。</p>}
      {dashboard.trend.some((row) => row.partial) && <p className={styles.partialNote}>＊ 表示這個月份只統計自訂日期範圍內的部分天數。</p>}
    </section>
  </div>;
}
