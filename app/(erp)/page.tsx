import { DashboardExperience } from "@/components/DashboardExperience";
import { getDashboardData } from "@/lib/data";

export default async function DashboardPage() {
  const data = await getDashboardData();
  return (
    <div className="dashboard-brand">
      <header className="page-header dashboard-header">
        <div className="dashboard-title">
          <div className="collection-line"><span>NEVERLAND®</span><span>SUPPLY DEPT. / 26SS</span></div>
          <div className="eyebrow">Operations control room</div>
          <h1>營運儀表板</h1>
          <div className="dashboard-title-en">Operations Dashboard</div>
          <p>庫存、寄賣與銷售表現的即時編輯報告。</p>
        </div>
        <div className="dashboard-edition" aria-label="資料狀態">
          <span>LIVE / DATA</span>
          <strong>NL—26</strong>
          <small>INVENTORY<br />CONSIGNMENT<br />SALES</small>
          <i>資料即時彙總</i>
        </div>
      </header>
      <DashboardExperience data={data} />
      <footer className="dashboard-footer"><span>NEVERLAND STUDIO® / INTERNAL USE</span><span>STOCKFLOW OPERATIONS SYSTEM</span></footer>
    </div>
  );
}
