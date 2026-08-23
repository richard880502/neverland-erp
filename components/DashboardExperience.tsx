"use client";

import { useMemo, useState } from "react";
import { CalendarDays, PackageSearch, RotateCcw, Store } from "lucide-react";
import { DashboardCharts, type TrendMode } from "@/components/DashboardCharts";

type DashboardDataset = {
  inventory: Array<{ productName: string; total: number; warehouse: number; consignment: number; lowStock: boolean; locations: Array<{ channelId: string; quantity: number }> }>;
  sales: Array<{ date: string; productName: string; channelId: string | null; channelName: string; quantity: number; revenue: number; countsAsTransaction: boolean }>;
  filters: { products: string[]; channels: Array<{ id: string; name: string }> };
  dateBounds: { min: string; max: string };
};

type PeriodMetrics = { revenue: number; units: number; transactions: number; average: number };
type DatePreset = "7" | "30" | "90" | "all" | null;

const money = new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function compactDate(value: string) {
  return value.replaceAll("-", ".");
}

function daySpan(start: string, end: string) {
  return Math.max(1, Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000) + 1);
}

function metrics(rows: DashboardDataset["sales"]): PeriodMetrics {
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const units = rows.reduce((sum, row) => sum + row.quantity, 0);
  return { revenue, units, transactions: rows.filter((row) => row.countsAsTransaction).length, average: units > 0 ? revenue / units : 0 };
}

function comparison(current: number, previous: number) {
  if (previous === 0) return current === 0 ? { label: "0%", direction: "flat" } : { label: "新增加", direction: "up" };
  const change = ((current - previous) / Math.abs(previous)) * 100;
  return { label: `${change > 0 ? "+" : ""}${change.toFixed(1)}%`, direction: change > 0 ? "up" : change < 0 ? "down" : "flat" };
}

function KpiDelta({ current, previous }: { current: number; previous: number }) {
  const value = comparison(current, previous);
  return <em className={`kpi-delta ${value.direction}`}>{value.label}<span>較前期</span></em>;
}

export function DashboardExperience({ data }: { data: DashboardDataset }) {
  const defaultStart = shiftDate(data.dateBounds.max, -29) < data.dateBounds.min ? data.dateBounds.min : shiftDate(data.dateBounds.max, -29);
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(data.dateBounds.max);
  const [selectedPreset, setSelectedPreset] = useState<DatePreset>("30");
  const [channelId, setChannelId] = useState("all");
  const [productName, setProductName] = useState("all");
  const [trendMode, setTrendMode] = useState<TrendMode>("revenue");

  const analysis = useMemo(() => {
    const span = daySpan(startDate, endDate);
    const previousEnd = shiftDate(startDate, -1);
    const previousStart = shiftDate(previousEnd, -(span - 1));
    const matchesDimensions = (row: DashboardDataset["sales"][number]) => (channelId === "all" || row.channelId === channelId) && (productName === "all" || row.productName === productName);
    const currentRows = data.sales.filter((row) => matchesDimensions(row) && row.date >= startDate && row.date <= endDate);
    const previousRows = data.sales.filter((row) => matchesDimensions(row) && row.date >= previousStart && row.date <= previousEnd);
    const currentMetrics = metrics(currentRows);
    const previousMetrics = metrics(previousRows);

    const trendMap = new Map<string, { date: string; revenue: number; units: number }>();
    for (let date = startDate; date <= endDate; date = shiftDate(date, 1)) trendMap.set(date, { date, revenue: 0, units: 0 });
    const channelMap = new Map<string, number>();
    const productMap = new Map<string, number>();
    for (const row of currentRows) {
      const point = trendMap.get(row.date);
      if (point) { point.revenue += row.revenue; point.units += row.quantity; }
      channelMap.set(row.channelName, (channelMap.get(row.channelName) ?? 0) + row.quantity);
      productMap.set(row.productName, (productMap.get(row.productName) ?? 0) + row.quantity);
    }

    const selectedInventory = productName === "all" ? data.inventory : data.inventory.filter((row) => row.productName === productName);
    const warehouse = selectedInventory.reduce((sum, row) => sum + row.warehouse, 0);
    const consignment = channelId === "all"
      ? selectedInventory.reduce((sum, row) => sum + row.consignment, 0)
      : selectedInventory.reduce((sum, row) => sum + (row.locations.find((location) => location.channelId === channelId)?.quantity ?? 0), 0);
    const allRankProducts = productName === "all" ? data.filters.products : [productName];
    const ranking = allRankProducts.map((name) => ({
      name,
      units: productMap.get(name) ?? 0,
      stock: data.inventory.filter((row) => row.productName === name).reduce((sum, row) => sum + row.total, 0),
    }));

    return {
      previousStart, previousEnd, currentRows, currentMetrics, previousMetrics,
      inventory: { total: warehouse + consignment, lowStock: selectedInventory.filter((row) => row.lowStock).length },
      trend: [...trendMap.values()],
      channels: [...channelMap.entries()].map(([name, value]) => ({ name, value })).filter((row) => row.value > 0).sort((a, b) => b.value - a.value),
      hotProducts: [...ranking].sort((a, b) => b.units - a.units || a.name.localeCompare(b.name, "zh-Hant")).slice(0, 8),
      slowProducts: [...ranking].sort((a, b) => a.units - b.units || b.stock - a.stock || a.name.localeCompare(b.name, "zh-Hant")).slice(0, 8),
    };
  }, [channelId, data, endDate, productName, startDate]);

  function applyPreset(days: number | "all") {
    setEndDate(data.dateBounds.max);
    setStartDate(days === "all" ? data.dateBounds.min : shiftDate(data.dateBounds.max, -(days - 1)) < data.dateBounds.min ? data.dateBounds.min : shiftDate(data.dateBounds.max, -(days - 1)));
    setSelectedPreset(days === "all" ? "all" : String(days) as DatePreset);
  }

  function changeStartDate(value: string) {
    setStartDate(value);
    setSelectedPreset(null);
  }

  function changeEndDate(value: string) {
    setEndDate(value);
    setSelectedPreset(null);
  }

  return <>
    <section className="dashboard-filter-panel" aria-label="儀表板篩選條件">
      <div className="dashboard-filter-title"><span>GLOBAL FILTER</span><strong>分析條件</strong><small>所有銷售圖表與比較數字同步更新</small></div>
      <label><CalendarDays size={15} /><span>開始日期</span><input type="date" min={data.dateBounds.min} max={endDate} value={startDate} onChange={(event) => changeStartDate(event.target.value)} /></label>
      <label><CalendarDays size={15} /><span>結束日期</span><input type="date" min={startDate} max={data.dateBounds.max} value={endDate} onChange={(event) => changeEndDate(event.target.value)} /></label>
      <label><Store size={15} /><span>通路</span><select value={channelId} onChange={(event) => setChannelId(event.target.value)}><option value="all">全部通路</option>{data.filters.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
      <label><PackageSearch size={15} /><span>商品</span><select value={productName} onChange={(event) => setProductName(event.target.value)}><option value="all">全部商品</option>{data.filters.products.map((product) => <option key={product} value={product}>{product}</option>)}</select></label>
      <div className="dashboard-range-control">
        <div className="dashboard-range-copy"><span>TIME RANGE</span><strong>{compactDate(startDate)} — {compactDate(endDate)}</strong></div>
        <div className="dashboard-presets" role="group" aria-label="快速日期範圍">
          <button type="button" className={selectedPreset === "7" ? "active" : undefined} aria-pressed={selectedPreset === "7"} onClick={() => applyPreset(7)}>7D</button>
          <button type="button" className={selectedPreset === "30" ? "active" : undefined} aria-pressed={selectedPreset === "30"} onClick={() => applyPreset(30)}>30D</button>
          <button type="button" className={selectedPreset === "90" ? "active" : undefined} aria-pressed={selectedPreset === "90"} onClick={() => applyPreset(90)}>90D</button>
          <button type="button" className={selectedPreset === "all" ? "active" : undefined} aria-pressed={selectedPreset === "all"} onClick={() => applyPreset("all")}>ALL</button>
          <button type="button" className="dashboard-reset" title="重設全部篩選" aria-label="重設全部篩選" onClick={() => { applyPreset(30); setChannelId("all"); setProductName("all"); }}><RotateCcw size={14} /></button>
        </div>
      </div>
    </section>
    <div className="comparison-period"><span className="comparison-period-label">比較期間</span><strong>{compactDate(analysis.previousStart)} — {compactDate(analysis.previousEnd)}</strong><span>依目前區間自動計算前一期</span></div>

    <section className="stat-grid dashboard-kpis">
      <div className="stat-card stat-revenue" data-index="01"><span>估算銷售額</span><strong>{money.format(analysis.currentMetrics.revenue)}</strong><KpiDelta current={analysis.currentMetrics.revenue} previous={analysis.previousMetrics.revenue} /><small>LIST-PRICE ESTIMATE</small></div>
      <div className="stat-card stat-sales" data-index="02"><span>售出件數</span><strong>{integer.format(analysis.currentMetrics.units)}</strong><KpiDelta current={analysis.currentMetrics.units} previous={analysis.previousMetrics.units} /><small>UNITS SOLD</small></div>
      <div className="stat-card stat-total" data-index="03"><span>銷售筆數</span><strong>{integer.format(analysis.currentMetrics.transactions)}</strong><KpiDelta current={analysis.currentMetrics.transactions} previous={analysis.previousMetrics.transactions} /><small>SALES EVENTS</small></div>
      <div className="stat-card stat-warehouse" data-index="04"><span>平均單件估值</span><strong>{money.format(analysis.currentMetrics.average)}</strong><KpiDelta current={analysis.currentMetrics.average} previous={analysis.previousMetrics.average} /><small>AVERAGE / UNIT</small></div>
      <div className="stat-card stat-consignment" data-index="05"><span>目前可用庫存</span><strong>{integer.format(analysis.inventory.total)}</strong><em className="kpi-delta flat">即時<span>非期間值</span></em><small>CURRENT STOCK</small></div>
      <div className="stat-card warn" data-index="06"><span>低庫存 SKU</span><strong>{integer.format(analysis.inventory.lowStock)}</strong><em className="kpi-delta flat">即時<span>安全庫存</span></em><small>RESTOCK ALERT</small></div>
    </section>

    <DashboardCharts data={{ trend: analysis.trend, channels: analysis.channels, hotProducts: analysis.hotProducts, slowProducts: analysis.slowProducts }} trendMode={trendMode} onTrendModeChange={setTrendMode} />
  </>;
}