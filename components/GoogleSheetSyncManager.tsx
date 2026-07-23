"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock3, DatabaseZap, ExternalLink, FileWarning, Link2, Plus, RefreshCw, Save } from "lucide-react";
import type { GoogleSheetSyncItem, GoogleSheetSyncSummary, SyncItemStatus } from "@/lib/google-sheet-sync";

type Run = {
  id: string;
  mode: string;
  status: string;
  source: string;
  spreadsheetTitle: string | null;
  sourceFetchedAt: string | null;
  summary: unknown;
  items?: unknown;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};
type Config = {
  spreadsheetId: string;
  timeZone: string;
  hour: number;
  minute: number;
  enabled: boolean;
  hasCredentials: boolean;
  demoAvailable: boolean;
  sourceMode: "GOOGLE_SHEETS_API" | "LOCAL_DEMO" | "UNAVAILABLE";
  scheduleLabel: string;
  stateCount: number;
};
type Connection = {
  id: string;
  spreadsheetId: string;
  spreadsheetTitle: string | null;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestSource: string | null;
  lastTestError: string | null;
  settingSource: "DATABASE" | "ENVIRONMENT";
};
type ConnectionTest = {
  spreadsheetId: string;
  spreadsheetTitle: string;
  source: "GOOGLE_SHEETS_API" | "LOCAL_DEMO";
  fetchedAt: string;
  sheets: string[];
};
type MovementQueue = {
  counts: Record<string, number>;
  recent: Array<{
    id: string;
    status: string;
    attempts: number;
    lastError: string | null;
    sheetRow: number | null;
    syncedAt: string | null;
    createdAt: string;
    movement: {
      id: string;
      occurredAt: string;
      type: string;
      quantity: number;
      unitPrice: number | null;
      product: { sku: string; name: string };
      channel: { name: string } | null;
    };
  }>;
};

const statusLabels: Record<SyncItemStatus, string> = {
  NEW: "新增",
  MODIFIED: "修改",
  CONFLICT: "衝突",
  ERROR: "錯誤",
  UNCHANGED: "相同",
};
const runStatusLabels: Record<string, string> = {
  FETCHING: "讀取中",
  PENDING_CONFIRMATION: "等待確認",
  APPLYING: "寫入中",
  COMPLETED: "完成",
  COMPLETED_WITH_ISSUES: "完成但有略過",
  FAILED: "失敗",
  CANCELLED: "已取消",
};
const movementLabels: Record<string, string> = {
  RECEIVE: "進貨", SHIP: "出貨", CONSIGN_OUT: "寄賣出貨", CONSIGN_RETURN: "寄賣退回",
  CONSIGN_SOLD: "寄賣售出", BUYOUT: "買斷", DEFECT: "瑕疵", ADJUSTMENT: "庫存調整",
};
const queueStatusLabels: Record<string, string> = {
  PENDING: "等待中", PROCESSING: "同步中", SYNCED: "已同步", FAILED: "失敗",
};

function asSummary(value: unknown): GoogleSheetSyncSummary {
  const source = value && typeof value === "object" ? value as Partial<GoogleSheetSyncSummary> : {};
  return {
    new: Number(source.new ?? 0),
    modified: Number(source.modified ?? 0),
    conflict: Number(source.conflict ?? 0),
    error: Number(source.error ?? 0),
    unchanged: Number(source.unchanged ?? 0),
    total: Number(source.total ?? 0),
    applied: source.applied == null ? undefined : Number(source.applied),
    skipped: source.skipped == null ? undefined : Number(source.skipped),
  };
}

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(new Date(value));
}

export function GoogleSheetSyncManager({ config, connection, movementQueue, history }: { config: Config; connection: Connection; movementQueue: MovementQueue; history: Run[] }) {
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState<"preview" | "apply" | "run-now" | "test" | "save" | "schedule" | "">("");
  const [error, setError] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [sheetReference, setSheetReference] = useState(`https://docs.google.com/spreadsheets/d/${connection.spreadsheetId}/edit`);
  const [connectionTest, setConnectionTest] = useState<ConnectionTest | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(config.enabled);
  const [scheduleTime, setScheduleTime] = useState(`${String(config.hour).padStart(2, "0")}:${String(config.minute).padStart(2, "0")}`);
  const [scheduleTimeZone, setScheduleTimeZone] = useState(config.timeZone);
  const [filter, setFilter] = useState<SyncItemStatus | "CHANGED">("CHANGED");
  const items = useMemo(() => Array.isArray(run?.items) ? run.items as GoogleSheetSyncItem[] : [], [run]);
  const summary = asSummary(run?.summary);
  const visibleItems = items.filter((item) => filter === "CHANGED" ? item.status !== "UNCHANGED" : item.status === filter);
  const safeCount = summary.new + summary.modified;

  async function submitConnection(action: "TEST" | "SAVE") {
    setError(""); setConnectionMessage(""); setConnectionTest(null); setLoading(action === "TEST" ? "test" : "save");
    const response = await fetch("/api/google-sheet-sync/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sheetReference, action }),
    });
    const result = await response.json(); setLoading("");
    if (!response.ok) return setError(result.error ?? "Google Sheet 連線失敗");
    setConnectionTest(result);
    if (action === "SAVE") {
      setConnectionMessage(`已儲存「${result.spreadsheetTitle}」，手動與定時同步會立即使用這份試算表。`);
      setRun(null);
      router.refresh();
    } else {
      setConnectionMessage(`連線成功：${result.spreadsheetTitle}`);
    }
  }

  async function requestPreview() {
    setError(""); setLoading("preview");
    const response = await fetch("/api/google-sheet-sync/preview", { method: "POST" });
    const result = await response.json(); setLoading("");
    if (!response.ok) return setError(result.error ?? "無法建立同步預覽");
    setRun(result); setFilter("CHANGED");
  }

  async function saveSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const [hour, minute] = scheduleTime.split(":").map(Number);
    setError(""); setConnectionMessage(""); setLoading("schedule");
    const response = await fetch("/api/google-sheet-sync/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        automaticSyncEnabled: scheduleEnabled,
        syncTimeZone: scheduleTimeZone,
        syncHour: hour,
        syncMinute: minute,
      }),
    });
    const result = await response.json(); setLoading("");
    if (!response.ok) return setError(result.error ?? "無法儲存定時同步設定");
    setConnectionMessage(`定時同步已${result.automaticSyncEnabled ? "啟用" : "停用"}：${String(result.syncHour).padStart(2, "0")}:${String(result.syncMinute).padStart(2, "0")} ${result.syncTimeZone}`);
    router.refresh();
  }

  async function applyPreview() {
    if (!run) return;
    const message = safeCount
      ? `將寫入 ${safeCount} 筆安全變更；衝突與錯誤不會寫入。確定繼續？`
      : "目前沒有資料變更，確認後只會建立同步比對基準。確定繼續？";
    if (!confirm(message)) return;
    setError(""); setLoading("apply");
    const response = await fetch(`/api/google-sheet-sync/${run.id}/apply`, { method: "POST" });
    const result = await response.json(); setLoading("");
    if (!response.ok) return setError(result.error ?? "同步套用失敗");
    setRun(result); router.refresh();
  }

  async function runNow() {
    if (!confirm("這會立即執行定時同步規則：自動寫入新增與安全修改，衝突及錯誤會略過。確定執行？")) return;
    setError(""); setLoading("run-now");
    const response = await fetch("/api/google-sheet-sync/run-now", { method: "POST" });
    const result = await response.json(); setLoading("");
    if (!response.ok) return setError(result.error ?? "立即同步失敗");
    setConnectionMessage(result.movementQueue?.message ?? `同步完成；庫存異動已送出 ${result.movementQueue?.processed ?? 0} 筆。`);
    setRun(result); router.refresh();
  }

  return <>
    <header className="page-header sync-page-header">
      <div><div className="eyebrow">Data bridge</div><h1>Google Sheet 同步</h1><p>先比對主檔，再確認寫入；定時同步只套用沒有衝突的安全變更。</p></div>
      <div className="header-actions"><span className={`badge ${config.hasCredentials ? "green" : "warn"}`}>{config.hasCredentials ? "Google API 已連線" : "本地 Demo 模式"}</span></div>
    </header>

    {error && <div className="form-error">{error}</div>}
    {connectionMessage && <div className="success-message">{connectionMessage}</div>}
    {config.sourceMode === "LOCAL_DEMO" && <div className="sync-demo-notice"><FileWarning size={18} /><div><strong>目前使用本地快照測試</strong><span>可完整測試預覽、確認與資料庫寫入；設定 Service Account 後會改讀線上 Google Sheet。</span></div></div>}

    <section className="panel sync-connection-panel">
      <div className="panel-header sync-connection-header"><div><span>CONNECTION</span><h2>同步來源設定</h2><p>貼上完整 Google Sheet 網址或試算表 ID；儲存前會先檢查名稱與必要分頁。</p></div><a className="btn btn-secondary" href={`https://docs.google.com/spreadsheets/d/${connection.spreadsheetId}/edit`} target="_blank" rel="noreferrer"><ExternalLink size={15} />開啟目前試算表</a></div>
      <div className="sync-connection-body">
        <div className="field sync-reference-field"><label htmlFor="google-sheet-reference">Google Sheet 網址／ID</label><div className="sync-reference-input"><Link2 size={17} /><input className="input" id="google-sheet-reference" value={sheetReference} onChange={(event) => { setSheetReference(event.target.value); setConnectionTest(null); setConnectionMessage(""); }} placeholder="https://docs.google.com/spreadsheets/d/…/edit" /></div><small>Service Account 金鑰不會存放在此頁，仍由 Zeabur 機密環境變數管理。</small></div>
        <div className="sync-connection-actions"><button className="btn btn-secondary" type="button" onClick={() => submitConnection("TEST")} disabled={Boolean(loading)}><RefreshCw size={15} className={loading === "test" ? "spin" : ""} />{loading === "test" ? "測試中…" : "測試連線"}</button><button className="btn btn-primary" type="button" onClick={() => submitConnection("SAVE")} disabled={Boolean(loading)}><Save size={15} />{loading === "save" ? "驗證並儲存中…" : "驗證並儲存設定"}</button></div>
      </div>
      <div className="sync-connection-meta">
        <div><span>目前試算表</span><strong>{connection.spreadsheetTitle ?? "尚未取得線上名稱"}</strong><small>{connection.spreadsheetId}</small></div>
        <div><span>設定來源</span><strong>{connection.settingSource === "DATABASE" ? "後台設定" : "環境變數預設值"}</strong><small>變更後不需重新部署</small></div>
        <div><span>最後測試</span><strong>{connection.lastTestStatus === "SUCCESS" ? "連線成功" : connection.lastTestStatus ?? "尚未測試"}</strong><small>{connection.lastTestedAt ? formatTime(connection.lastTestedAt) : "—"}{connection.lastTestSource === "LOCAL_DEMO" ? " · 本地快照" : connection.lastTestSource === "GOOGLE_SHEETS_API" ? " · Google API" : ""}</small></div>
      </div>
      {connectionTest && <div className="sync-test-result"><CheckCircle2 size={17} /><div><strong>{connectionTest.spreadsheetTitle}</strong><span>{connectionTest.source === "LOCAL_DEMO" ? "本地快照驗證" : "Google API 即時連線"} · 已確認分頁：{connectionTest.sheets.join("、")}</span></div></div>}
    </section>

    <section className="sync-config-grid">
      <div className="panel sync-config-card"><div className="sync-card-icon"><Clock3 size={20} /></div><span>每日排程</span><strong>{config.scheduleLabel}</strong><small>{config.timeZone}（UTC+8）</small><em className={`badge ${config.enabled ? "green" : "warn"}`}>{config.enabled ? "已啟用" : "尚未啟用"}</em></div>
      <div className="panel sync-config-card"><div className="sync-card-icon"><DatabaseZap size={20} /></div><span>同步內容</span><strong>商品＋價格＋通路</strong><small>空白價格不會覆蓋 ERP；不自動停用或刪除</small><em>{config.stateCount} 筆已建立比對基準</em></div>
      <div className="panel sync-action-card"><div><span>同步控制</span><strong>預覽或馬上同步</strong><small>預覽只比較主檔；馬上同步會先處理主檔，再送出庫存異動 Queue。</small></div><button className="btn btn-primary" onClick={requestPreview} disabled={Boolean(loading)}><RefreshCw size={16} className={loading === "preview" ? "spin" : ""} />{loading === "preview" ? "讀取中…" : "從 Google Sheet 預覽主檔"}</button><button className="btn btn-secondary" onClick={runNow} disabled={Boolean(loading)}>{loading === "run-now" ? "同步中…" : "馬上同步全部"}</button></div>
    </section>

    <section className="panel sync-schedule-panel">
      <div className="panel-header"><div><span>AUTOMATION</span><h2>定時同步設定</h2><p>每天在指定時區執行一次：先同步商品與通路，再送出庫存異動等待區。</p></div></div>
      <form className="sync-schedule-form" onSubmit={saveSchedule}>
        <label className="sync-toggle"><input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} /><span><strong>啟用每日定時同步</strong><small>關閉後仍可使用「馬上同步全部」。</small></span></label>
        <div className="field"><label htmlFor="sync-time">執行時間</label><input className="input" id="sync-time" type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} required /></div>
        <div className="field"><label htmlFor="sync-time-zone">IANA 時區</label><input className="input" id="sync-time-zone" value={scheduleTimeZone} onChange={(event) => setScheduleTimeZone(event.target.value)} placeholder="Asia/Taipei" required /></div>
        <button className="btn btn-primary" disabled={Boolean(loading)}><Save size={15} />{loading === "schedule" ? "儲存中…" : "儲存定時設定"}</button>
      </form>
    </section>

    <section className="panel sync-queue-panel">
      <div className="panel-header sync-queue-header"><div><span>OUTBOX QUEUE</span><h2>庫存異動等待區</h2><p>ERP 新增與沖銷異動會自動入列；Google Sheet 寫入成功前不會移出等待區。</p></div><button className="btn btn-primary" onClick={runNow} disabled={Boolean(loading)}><RefreshCw size={15} className={loading === "run-now" ? "spin" : ""} />馬上同步</button></div>
      <div className="sync-queue-summary">
        <div><span>等待中</span><strong>{movementQueue.counts.PENDING ?? 0}</strong></div>
        <div><span>同步中</span><strong>{movementQueue.counts.PROCESSING ?? 0}</strong></div>
        <div><span>失敗待重試</span><strong>{movementQueue.counts.FAILED ?? 0}</strong></div>
        <div><span>已同步</span><strong>{movementQueue.counts.SYNCED ?? 0}</strong></div>
      </div>
      <div className="table-wrap"><table><thead><tr><th>入列時間</th><th>狀態</th><th>日期</th><th>事件</th><th>SKU／商品</th><th>通路</th><th className="number">數量</th><th>Sheet 列</th><th>結果</th></tr></thead><tbody>
        {movementQueue.recent.length ? movementQueue.recent.map((item) => <tr key={item.id}><td>{formatTime(item.createdAt)}</td><td><span className={`sync-status queue-${item.status.toLowerCase()}`}>{queueStatusLabels[item.status] ?? item.status}</span></td><td>{new Date(item.movement.occurredAt).toLocaleDateString("zh-TW")}</td><td>{movementLabels[item.movement.type] ?? item.movement.type}</td><td><strong>{item.movement.product.sku}</strong><div className="muted small-text">{item.movement.product.name}</div></td><td>{item.movement.channel?.name ?? "初始化"}</td><td className="number">{item.movement.quantity}</td><td>{item.sheetRow ?? "—"}</td><td>{item.lastError ? <span className="sync-message">{item.lastError}</span> : item.syncedAt ? formatTime(item.syncedAt) : `已嘗試 ${item.attempts} 次`}</td></tr>) : <tr><td colSpan={9} className="empty-cell">目前沒有等待同步的庫存異動；新增異動後會自動出現在這裡。</td></tr>}
      </tbody></table></div>
    </section>

    {run?.status === "PENDING_CONFIRMATION" && <section className="panel sync-preview">
      <div className="panel-header sync-preview-header"><div><span>PREVIEW</span><h2>同步預覽</h2><p>{run.spreadsheetTitle} · 來源更新 {formatTime(run.sourceFetchedAt)}</p></div><button className="btn btn-primary" onClick={applyPreview} disabled={loading === "apply"}><CheckCircle2 size={16} />{loading === "apply" ? "寫入中…" : safeCount ? `確認並寫入 ${safeCount} 筆` : "確認並建立基準"}</button></div>
      <div className="sync-summary">
        <button className={filter === "NEW" ? "active" : ""} onClick={() => setFilter("NEW")}><Plus size={16} /><span>新增</span><strong>{summary.new}</strong></button>
        <button className={filter === "MODIFIED" ? "active" : ""} onClick={() => setFilter("MODIFIED")}><RefreshCw size={16} /><span>修改</span><strong>{summary.modified}</strong></button>
        <button className={filter === "CONFLICT" ? "active" : ""} onClick={() => setFilter("CONFLICT")}><AlertTriangle size={16} /><span>衝突</span><strong>{summary.conflict}</strong></button>
        <button className={filter === "ERROR" ? "active" : ""} onClick={() => setFilter("ERROR")}><FileWarning size={16} /><span>錯誤</span><strong>{summary.error}</strong></button>
        <button className={filter === "UNCHANGED" ? "active" : ""} onClick={() => setFilter("UNCHANGED")}><CheckCircle2 size={16} /><span>相同</span><strong>{summary.unchanged}</strong></button>
      </div>
      <div className="sync-filter-line"><button className={filter === "CHANGED" ? "active" : ""} onClick={() => setFilter("CHANGED")}>顯示所有需要注意的項目</button><span>衝突與錯誤會保留在報告，不會寫入資料庫。</span></div>
      <div className="table-wrap"><table className="sync-table"><thead><tr><th>狀態</th><th>主檔</th><th>項目</th><th>來源列</th><th>變更內容／原因</th></tr></thead><tbody>
        {visibleItems.length ? visibleItems.map((item) => <tr key={item.id}><td><span className={`sync-status sync-${item.status.toLowerCase()}`}>{statusLabels[item.status]}</span></td><td>{item.entityType === "PRODUCT" ? "商品主檔" : "通路主檔"}</td><td><strong>{item.label}</strong></td><td>{item.sourceRow ?? "—"}</td><td>{item.message ? <span className="sync-message">{item.message}</span> : item.changes.length ? <div className="sync-changes">{item.changes.map((change) => <span key={change.field}><b>{change.label}</b>{change.before} → {change.after}</span>)}</div> : <span className="muted">資料一致</span>}</td></tr>) : <tr><td colSpan={5} className="empty-cell">此分類沒有資料</td></tr>}
      </tbody></table></div>
    </section>}

    {run && run.status !== "PENDING_CONFIRMATION" && <div className={`sync-result ${run.status === "FAILED" ? "failed" : ""}`}><CheckCircle2 size={20} /><div><strong>{runStatusLabels[run.status] ?? run.status}</strong><span>{run.error ?? `已寫入 ${asSummary(run.summary).applied ?? 0} 筆，略過 ${asSummary(run.summary).skipped ?? 0} 筆。`}</span></div></div>}

    <section className="panel table-panel sync-history"><div className="panel-header"><div><span>HISTORY</span><h2>同步紀錄</h2></div></div><div className="table-wrap"><table><thead><tr><th>時間</th><th>模式</th><th>來源</th><th>結果</th><th>新增</th><th>修改</th><th>衝突</th><th>錯誤</th><th>寫入</th></tr></thead><tbody>
      {history.length ? history.map((item) => { const result = asSummary(item.summary); return <tr key={item.id}><td>{formatTime(item.createdAt)}</td><td>{item.mode === "MANUAL" ? "手動確認" : "定時／立即"}</td><td>{item.source === "LOCAL_DEMO" ? "本地快照" : "Google API"}</td><td><span className={`badge ${item.status === "COMPLETED" ? "green" : item.status === "FAILED" ? "warn" : ""}`}>{runStatusLabels[item.status] ?? item.status}</span></td><td>{result.new}</td><td>{result.modified}</td><td>{result.conflict}</td><td>{result.error}</td><td>{result.applied ?? "—"}</td></tr>; }) : <tr><td colSpan={9} className="empty-cell">尚無同步紀錄</td></tr>}
    </tbody></table></div></section>
  </>;
}
