"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type TrendMode = "revenue" | "units";
type DashboardChartData = {
  trend: { date: string; revenue: number; units: number }[];
  channels: { name: string; value: number }[];
  hotProducts: { name: string; units: number; stock: number }[];
  slowProducts: { name: string; units: number; stock: number }[];
};

const colors = ["#18181b", "#7c3aed", "#2563eb", "#0f766e", "#d97706", "#db2777"];
const money = (value: number) => `NT$ ${new Intl.NumberFormat("zh-TW").format(value)}`;
const tooltipStyle = { border: "1px solid #e4e4e7", borderRadius: 8, background: "#ffffff", fontSize: 12, boxShadow: "0 8px 28px rgba(24, 24, 27, .12)" };
const axisTick = { fontSize: 10, fill: "#71717a", fontFamily: "Inter, ui-sans-serif, sans-serif" };

export function DashboardCharts({ data, trendMode, onTrendModeChange }: { data: DashboardChartData; trendMode: TrendMode; onTrendModeChange: (mode: TrendMode) => void }) {
  const trendIsRevenue = trendMode === "revenue";
  return <>
    <section className="chart-grid">
      <div className="panel dashboard-panel">
        <div className="panel-header"><div><span className="panel-index">Sales</span><h2>{trendIsRevenue ? "估算銷售額趨勢" : "銷售件數趨勢"}</h2></div><div className="chart-mode-toggle"><button className={trendIsRevenue ? "active" : ""} onClick={() => onTrendModeChange("revenue")}>銷售額</button><button className={!trendIsRevenue ? "active" : ""} onClick={() => onTrendModeChange("units")}>銷量</button></div></div>
        <div className="chart"><ResponsiveContainer>
          <LineChart data={data.trend} margin={{ top: 8, right: 12, bottom: 4, left: 6 }}>
            <CartesianGrid stroke="#e4e4e7" vertical={false} strokeDasharray="2 5" />
            <XAxis dataKey="date" tick={axisTick} tickFormatter={(value) => value.slice(5)} axisLine={{ stroke: "#d4d4d8" }} tickLine={false} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(value) => trendIsRevenue ? `${Math.round(value / 1000)}k` : String(value)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => trendIsRevenue ? money(Number(value)) : `${value} 件`} labelFormatter={(label) => `日期 ${label}`} />
            <Line type="monotone" dataKey={trendMode} name={trendIsRevenue ? "估算銷售額" : "售出件數"} stroke="#7c3aed" strokeWidth={2} dot={{ r: 3, fill: "#7c3aed", stroke: "#ffffff", strokeWidth: 2 }} activeDot={{ r: 5, fill: "#6d28d9" }} />
          </LineChart>
        </ResponsiveContainer></div>
      </div>
      <div className="panel dashboard-panel">
        <div className="panel-header"><div><span className="panel-index">Channel mix</span><h2>銷售通路占比</h2></div><span>依篩選期間售出件數</span></div>
        <div className="chart"><ResponsiveContainer>
          <PieChart><Pie data={data.channels} dataKey="value" nameKey="name" innerRadius={66} outerRadius={102} paddingAngle={1} stroke="#ffffff" strokeWidth={2}>
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
            <CartesianGrid stroke="#e4e4e7" horizontal={false} strokeDasharray="2 5" /><XAxis type="number" axisLine={{ stroke: "#d4d4d8" }} tickLine={false} tick={axisTick} /><YAxis type="category" dataKey="name" width={120} axisLine={false} tickLine={false} tick={axisTick} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => name === "stock" ? `${value} 件庫存` : `${value} 件售出`} /><Bar dataKey="units" name="售出" fill="#2563eb" radius={[0, 4, 4, 0]} barSize={18} />
          </BarChart>
        </ResponsiveContainer></div>
      </div>
      <div className="panel dashboard-panel">
        <div className="panel-header"><div><span className="panel-index">Slow products</span><h2>滯銷商品排行</h2></div><span>後 8 名 · 含零銷量</span></div>
        <div className="chart"><ResponsiveContainer>
          <BarChart data={data.slowProducts} layout="vertical" margin={{ left: 20, right: 16 }}>
            <CartesianGrid stroke="#e4e4e7" horizontal={false} strokeDasharray="2 5" /><XAxis type="number" axisLine={{ stroke: "#d4d4d8" }} tickLine={false} tick={axisTick} /><YAxis type="category" dataKey="name" width={120} axisLine={false} tickLine={false} tick={axisTick} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => name === "stock" ? `${value} 件庫存` : `${value} 件售出`} /><Bar dataKey="units" name="售出" fill="#a1a1aa" radius={[0, 4, 4, 0]} barSize={18} />
          </BarChart>
        </ResponsiveContainer></div>
      </div>
    </section>
  </>;
}
