"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type TrendMode = "revenue" | "units";
type DashboardChartData = {
  trend: { date: string; revenue: number; units: number }[];
  channels: { name: string; value: number }[];
  hotProducts: { name: string; units: number; stock: number }[];
  slowProducts: { name: string; units: number; stock: number }[];
};

const colors = ["#171816", "#b95431", "#547188", "#d8d5cc", "#796a5d", "#a5a7a1"];
const money = (value: number) => `NT$ ${new Intl.NumberFormat("zh-TW").format(value)}`;
const tooltipStyle = { border: "1px solid #171816", borderRadius: 0, background: "#f7f6f1", fontSize: 12 };
const axisTick = { fontSize: 10, fill: "#696a65", fontFamily: "Arial, sans-serif" };

export function DashboardCharts({ data, trendMode, onTrendModeChange }: { data: DashboardChartData; trendMode: TrendMode; onTrendModeChange: (mode: TrendMode) => void }) {
  const trendIsRevenue = trendMode === "revenue";
  return <>
    <section className="chart-grid">
      <div className="panel dashboard-panel">
        <div className="panel-header"><div><span className="panel-index">FIG.01 / SALES</span><h2>{trendIsRevenue ? "估算銷售額趨勢" : "銷售件數趨勢"}</h2></div><div className="chart-mode-toggle"><button className={trendIsRevenue ? "active" : ""} onClick={() => onTrendModeChange("revenue")}>銷售額</button><button className={!trendIsRevenue ? "active" : ""} onClick={() => onTrendModeChange("units")}>銷量</button></div></div>
        <div className="chart"><ResponsiveContainer>
          <LineChart data={data.trend} margin={{ top: 8, right: 12, bottom: 4, left: 6 }}>
            <CartesianGrid stroke="#d9d7cf" vertical={false} strokeDasharray="2 5" />
            <XAxis dataKey="date" tick={axisTick} tickFormatter={(value) => value.slice(5)} axisLine={{ stroke: "#171816" }} tickLine={false} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(value) => trendIsRevenue ? `${Math.round(value / 1000)}k` : String(value)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => trendIsRevenue ? money(Number(value)) : `${value} 件`} labelFormatter={(label) => `日期 ${label}`} />
            <Line type="monotone" dataKey={trendMode} name={trendIsRevenue ? "估算銷售額" : "售出件數"} stroke="#171816" strokeWidth={2} dot={{ r: 3, fill: "#b95431", stroke: "#f7f6f1", strokeWidth: 2 }} activeDot={{ r: 6, fill: "#b95431" }} />
          </LineChart>
        </ResponsiveContainer></div>
      </div>
      <div className="panel dashboard-panel">
        <div className="panel-header"><div><span className="panel-index">FIG.02 / CHANNEL</span><h2>銷售通路占比</h2></div><span>依篩選期間售出件數</span></div>
        <div className="chart"><ResponsiveContainer>
          <PieChart><Pie data={data.channels} dataKey="value" nameKey="name" innerRadius={66} outerRadius={102} paddingAngle={1} stroke="#f7f6f1" strokeWidth={2}>
            {data.channels.map((entry, index) => <Cell key={entry.name} fill={colors[index % colors.length]} />)}
          </Pie><Tooltip contentStyle={tooltipStyle} formatter={(value) => `${value} 件`} /><Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11 }} /></PieChart>
        </ResponsiveContainer></div>
      </div>
    </section>
    <section className="chart-grid">
      <div className="panel dashboard-panel">
        <div className="panel-header"><div><span className="panel-index">FIG.03 / HOT</span><h2>熱銷商品排行</h2></div><span>TOP 08</span></div>
        <div className="chart"><ResponsiveContainer>
          <BarChart data={data.hotProducts} layout="vertical" margin={{ left: 20, right: 16 }}>
            <CartesianGrid stroke="#d9d7cf" horizontal={false} strokeDasharray="2 5" /><XAxis type="number" axisLine={{ stroke: "#171816" }} tickLine={false} tick={axisTick} /><YAxis type="category" dataKey="name" width={120} axisLine={false} tickLine={false} tick={axisTick} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => name === "stock" ? `${value} 件庫存` : `${value} 件售出`} /><Bar dataKey="units" name="售出" fill="#547188" radius={0} barSize={18} />
          </BarChart>
        </ResponsiveContainer></div>
      </div>
      <div className="panel dashboard-panel">
        <div className="panel-header"><div><span className="panel-index">FIG.04 / SLOW</span><h2>滯銷商品排行</h2></div><span>LOW 08 / 含零銷量</span></div>
        <div className="chart"><ResponsiveContainer>
          <BarChart data={data.slowProducts} layout="vertical" margin={{ left: 20, right: 16 }}>
            <CartesianGrid stroke="#d9d7cf" horizontal={false} strokeDasharray="2 5" /><XAxis type="number" axisLine={{ stroke: "#171816" }} tickLine={false} tick={axisTick} /><YAxis type="category" dataKey="name" width={120} axisLine={false} tickLine={false} tick={axisTick} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => name === "stock" ? `${value} 件庫存` : `${value} 件售出`} /><Bar dataKey="units" name="售出" fill="#b95431" radius={0} barSize={18} />
          </BarChart>
        </ResponsiveContainer></div>
      </div>
    </section>
  </>;
}
