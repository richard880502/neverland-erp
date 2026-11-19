"use client";

import { useSyncExternalStore } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type TrendMode = "revenue" | "units";
type DashboardChartData = {
  trend: { date: string; revenue: number; units: number }[];
  channels: { name: string; value: number }[];
  hotProducts: { name: string; units: number; stock: number }[];
  slowProducts: { name: string; units: number; stock: number }[];
};

const colors = ["var(--ui-chart-neutral)", "var(--ui-chart-primary)", "var(--ui-chart-tertiary)", "var(--ui-chart-secondary)", "var(--ui-chart-warning)", "var(--ui-chart-negative)"];
const money = (value: number) => `NT$ ${new Intl.NumberFormat("zh-TW").format(value)}`;
const tooltipStyle = { border: "1px solid var(--ui-border-base)", color: "var(--ui-fg-base)", borderRadius: 8, background: "var(--ui-bg-base)", fontSize: 12, boxShadow: "var(--ui-shadow-flyout)" };
const axisTick = { fontSize: 10, fill: "var(--ui-fg-muted)", fontFamily: "Inter, ui-sans-serif, sans-serif" };

function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function DashboardCharts({ data, trendMode, onTrendModeChange }: { data: DashboardChartData; trendMode: TrendMode; onTrendModeChange: (mode: TrendMode) => void }) {
  const reducedMotion = useSyncExternalStore(subscribeMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => true);
  const trendIsRevenue = trendMode === "revenue";
  return <>
    <section className="chart-grid">
      <div className="panel dashboard-panel">
        <div className="panel-header"><div><span className="panel-index">Sales</span><h2>{trendIsRevenue ? "估算銷售額趨勢" : "銷售件數趨勢"}</h2></div><div className="chart-mode-toggle" role="group" aria-label="趨勢圖顯示方式"><button type="button" aria-pressed={trendIsRevenue} className={trendIsRevenue ? "active" : ""} onClick={() => onTrendModeChange("revenue")}>銷售額</button><button type="button" aria-pressed={!trendIsRevenue} className={!trendIsRevenue ? "active" : ""} onClick={() => onTrendModeChange("units")}>銷量</button></div></div>
        <div className="chart"><ResponsiveContainer>
          <LineChart data={data.trend} margin={{ top: 8, right: 12, bottom: 4, left: 6 }}>
            <CartesianGrid stroke="var(--ui-chart-grid)" vertical={false} strokeDasharray="2 5" />
            <XAxis dataKey="date" tick={axisTick} tickFormatter={(value) => value.slice(5)} axisLine={{ stroke: "var(--ui-chart-axis)" }} tickLine={false} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(value) => trendIsRevenue ? `${Math.round(value / 1000)}k` : String(value)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => trendIsRevenue ? money(Number(value)) : `${value} 件`} labelFormatter={(label) => `日期 ${label}`} />
            <Line isAnimationActive={!reducedMotion} type="monotone" dataKey={trendMode} name={trendIsRevenue ? "估算銷售額" : "售出件數"} stroke="var(--ui-chart-primary)" strokeWidth={2} dot={{ r: 3, fill: "var(--ui-chart-primary)", stroke: "var(--ui-bg-base)", strokeWidth: 2 }} activeDot={{ r: 5, fill: "var(--ui-chart-primary)" }} />
          </LineChart>
        </ResponsiveContainer></div>
      </div>
      <div className="panel dashboard-panel">
        <div className="panel-header"><div><span className="panel-index">Channel mix</span><h2>銷售通路占比</h2></div><span>依篩選期間售出件數</span></div>
        <div className="chart"><ResponsiveContainer>
          <PieChart><Pie isAnimationActive={!reducedMotion} data={data.channels} dataKey="value" nameKey="name" innerRadius={66} outerRadius={102} paddingAngle={1} stroke="var(--ui-bg-base)" strokeWidth={2}>
            {data.channels.map((entry, index) => <Cell key={entry.name} fill={colors[index % colors.length]} />)}
          </Pie><Tooltip contentStyle={tooltipStyle} formatter={(value) => `${value} 件`} /><Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} /></PieChart>
        </ResponsiveContainer></div>
      </div>
    </section>
    <section className="chart-grid">
      <div className="panel dashboard-panel">
        <div className="panel-header"><div><span className="panel-index">Top products</span><h2>熱銷商品排行</h2></div><span>前 8 名</span></div>
        <div className="chart"><ResponsiveContainer>
          <BarChart data={data.hotProducts} layout="vertical" margin={{ left: 20, right: 16 }}>
            <CartesianGrid stroke="var(--ui-chart-grid)" horizontal={false} strokeDasharray="2 5" /><XAxis type="number" axisLine={{ stroke: "var(--ui-chart-axis)" }} tickLine={false} tick={axisTick} /><YAxis type="category" dataKey="name" width={120} axisLine={false} tickLine={false} tick={axisTick} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => name === "stock" ? `${value} 件庫存` : `${value} 件售出`} /><Bar isAnimationActive={!reducedMotion} dataKey="units" name="售出" fill="var(--ui-chart-primary)" radius={[0, 4, 4, 0]} barSize={18} />
          </BarChart>
        </ResponsiveContainer></div>
      </div>
      <div className="panel dashboard-panel">
        <div className="panel-header"><div><span className="panel-index">Slow products</span><h2>滯銷商品排行</h2></div><span>後 8 名 · 含零銷量</span></div>
        <div className="chart"><ResponsiveContainer>
          <BarChart data={data.slowProducts} layout="vertical" margin={{ left: 20, right: 16 }}>
            <CartesianGrid stroke="var(--ui-chart-grid)" horizontal={false} strokeDasharray="2 5" /><XAxis type="number" axisLine={{ stroke: "var(--ui-chart-axis)" }} tickLine={false} tick={axisTick} /><YAxis type="category" dataKey="name" width={120} axisLine={false} tickLine={false} tick={axisTick} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => name === "stock" ? `${value} 件庫存` : `${value} 件售出`} /><Bar isAnimationActive={!reducedMotion} dataKey="units" name="售出" fill="var(--ui-fg-muted)" radius={[0, 4, 4, 0]} barSize={18} />
          </BarChart>
        </ResponsiveContainer></div>
      </div>
    </section>
  </>;
}
