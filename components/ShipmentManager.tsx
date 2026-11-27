"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileSpreadsheet, PackageCheck, Pencil, Plus, Trash2, Truck } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { ShipmentProductPicker, type ShipmentKind, type ShipmentProduct, type ShipmentSelection } from "@/components/ShipmentProductPicker";

type Channel = {
  id: string; name: string; type: string; contactName: string | null; contactPhone: string | null; billingAddress: string | null;
  settlementRate: number | null; defaultShippingMethod: string | null; defaultShippingFee: number | null; defaultShippingPayer: string | null;
  hasShippingSheet: boolean;
};
type Line = { productId: string; sku: string; name: string; size: string | null; quantity: number; retailPrice: number; tradePrice: number };
type Freight = { actual: number; paid: number; recoverable: number } | null;
type Shipment = {
  id: string; channelId: string; channel: string; kind: ShipmentKind; status: "DRAFT" | "DISPATCHED"; createdDate: string; plannedDate: string; dispatchedAt: string | null;
  recipient: string; contactPhone: string; address: string; note: string; shippingMethod: string; freight: Freight; freightClaimed: boolean; sheetUrl: string | null; lines: Line[];
};
type FreightDraft = { actual: string; paid: string; recoverable: string };
type FormState = {
  channelId: string; kind: ShipmentKind; plannedDate: string; recipient: string; contactPhone: string; address: string; note: string;
  shippingMethod: string; freight: FreightDraft; lines: ShipmentSelection[];
};

const shippingMethods = ["7-11 店到店", "全家店到店", "郵局", "黑貓宅急便", "新竹物流", "Lalamove", "親送", "其他"];
const emptyFreight: FreightDraft = { actual: "", paid: "", recoverable: "" };
const emptyForm = (): FormState => ({ channelId: "", kind: "CONSIGNMENT", plannedDate: "", recipient: "", contactPhone: "", address: "", note: "", shippingMethod: "", freight: emptyFreight, lines: [] });
const money = (value: number) => `NT$ ${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(value)}`;
const percentage = new Intl.NumberFormat("zh-TW", { style: "percent", maximumFractionDigits: 2 });
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const freightToDraft = (freight: Freight): FreightDraft => freight ? { actual: String(freight.actual), paid: String(freight.paid), recoverable: String(freight.recoverable) } : emptyFreight;

function parseFreight(draft: FreightDraft): { freight: Freight; error: string | null } {
  const raw = [draft.actual, draft.paid, draft.recoverable];
  if (raw.every((value) => value.trim() === "")) return { freight: null, error: null };
  if (raw.some((value) => value.trim() === "")) return { freight: null, error: "運費三格要一起填，或全部留空表示「待確認」" };
  const [actual, paid, recoverable] = raw.map(Number);
  if ([actual, paid, recoverable].some((value) => !Number.isFinite(value) || value < 0)) return { freight: null, error: "運費必須是 0 以上的數字" };
  if (paid > actual) return { freight: null, error: "我方支付不可超過實際運費" };
  if (recoverable > paid) return { freight: null, error: "向通路回收不可超過我方支付" };
  return { freight: { actual, paid, recoverable }, error: null };
}

function channelFreightDefaults(channel: Channel | undefined): FreightDraft {
  if (!channel || channel.defaultShippingFee == null) return emptyFreight;
  const fee = String(channel.defaultShippingFee);
  if (channel.defaultShippingPayer === "REIMBURSABLE") return { actual: fee, paid: fee, recoverable: fee };
  if (channel.defaultShippingPayer === "CHANNEL" || channel.defaultShippingPayer === "CUSTOMER") return { actual: fee, paid: "0", recoverable: "0" };
  return { actual: fee, paid: fee, recoverable: "0" };
}

function FreightEditor({ value, onChange, disabled }: { value: FreightDraft; onChange: (next: FreightDraft) => void; disabled?: boolean }) {
  const { freight, error } = parseFreight(value);
  const preset = (mode: "full" | "split" | "company" | "dealer") => {
    const actual = value.actual.trim() === "" ? "" : value.actual;
    if (mode === "full") onChange({ actual, paid: actual, recoverable: actual });
    if (mode === "split") onChange({ actual, paid: actual, recoverable: value.recoverable && value.recoverable !== actual ? value.recoverable : "" });
    if (mode === "company") onChange({ actual, paid: actual, recoverable: "0" });
    if (mode === "dealer") onChange({ actual, paid: "0", recoverable: "0" });
  };
  return <div className="shipment-freight">
    <div className="shipment-freight-presets">
      <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => preset("full")}>全額代墊</button>
      <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => preset("split")}>部分分攤</button>
      <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => preset("company")}>公司全額吸收</button>
      <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => preset("dealer")}>對方直接付物流</button>
      <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => onChange(emptyFreight)}>待確認</button>
    </div>
    <div className="billing-three-col">
      <div className="field"><label>實際運費</label><input className="input" type="number" min="0" step="1" disabled={disabled} value={value.actual} onChange={(event) => onChange({ ...value, actual: event.target.value })} placeholder="待確認" /></div>
      <div className="field"><label>Neverland 先付</label><input className="input" type="number" min="0" step="1" disabled={disabled} value={value.paid} onChange={(event) => onChange({ ...value, paid: event.target.value })} placeholder="待確認" /></div>
      <div className="field"><label>向通路回收</label><input className="input" type="number" min="0" step="1" disabled={disabled} value={value.recoverable} onChange={(event) => onChange({ ...value, recoverable: event.target.value })} placeholder="待確認" /></div>
    </div>
    {error ? <p className="form-error">{error}</p> : <p className="billing-hint">{freight
      ? `財務記 ${money(freight.paid)} 物流支出；之後請款向通路收 ${money(freight.recoverable)}；Neverland 吸收 ${money(round(freight.paid - freight.recoverable))}。同一張出貨單只會請款一次。`
      : "運費待確認：出貨時不會記運費，拿到物流金額後再到出貨紀錄補登。"}</p>}
  </div>;
}

export function ShipmentManager({ channels, products, shipments, canWrite }: { channels: Channel[]; products: ShipmentProduct[]; shipments: Shipment[]; canWrite: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [freightEditing, setFreightEditing] = useState<{ id: string; value: FreightDraft } | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "DRAFT" | "DISPATCHED">("ALL");

  const channel = channels.find((item) => item.id === form.channelId);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const rate = form.kind === "BUYOUT" ? 0.5 : channel?.settlementRate ?? null;
  const editingShipment = editing ? shipments.find((item) => item.id === editing) : undefined;
  const dealLabel = form.kind === "BUYOUT" ? "首批買斷 50%" : rate ? `寄賣 ${percentage.format(rate)}` : "寄賣";

  function pricesFor(product: ShipmentProduct, kind: ShipmentKind) {
    // Saved drafts keep their price snapshot while channel and deal type are unchanged.
    const snapshot = editingShipment?.channelId === form.channelId && editingShipment.kind === kind
      ? editingShipment.lines.find((line) => line.productId === product.id)
      : undefined;
    const retail = snapshot?.retailPrice ?? product.listPrice;
    const dealRate = kind === "BUYOUT" ? 0.5 : channel?.settlementRate;
    const trade = snapshot?.tradePrice ?? (retail != null && dealRate ? round(retail * dealRate) : null);
    return { retail, trade };
  }

  const preview = form.lines.flatMap((line) => {
    const product = productById.get(line.productId);
    if (!product) return [];
    return [{ product, quantity: line.quantity, ...pricesFor(product, form.kind), short: line.quantity > product.warehouse }];
  });
  const totalQuantity = preview.reduce((sum, item) => sum + item.quantity, 0);
  const totalTrade = round(preview.reduce((sum, item) => sum + (item.trade ?? 0) * item.quantity, 0));
  const freightCheck = parseFreight(form.freight);
  const missingPrice = preview.some((item) => item.product.listPrice == null);
  const canSave = canWrite && !busy && Boolean(channel) && preview.length > 0 && preview.length === form.lines.length && !missingPrice && Boolean(rate) && !freightCheck.error;

  function selectChannel(id: string) {
    const next = channels.find((item) => item.id === id);
    setForm((current) => ({
      ...current, channelId: id,
      kind: next?.type === "BUYOUT" ? "BUYOUT" : "CONSIGNMENT",
      recipient: next?.contactName ?? "", contactPhone: next?.contactPhone ?? "", address: next?.billingAddress ?? "",
      shippingMethod: next?.defaultShippingMethod ?? current.shippingMethod,
      freight: channelFreightDefaults(next),
    }));
  }

  function resetForm() { setForm(emptyForm()); setEditing(null); }

  async function call(url: string, init: RequestInit, success: string) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "操作失敗");
      setMessage({ tone: "ok", text: success });
      router.refresh();
      return result;
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "操作失敗" });
      return null;
    } finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    const body = {
      channelId: form.channelId, kind: form.kind, plannedDate: form.plannedDate, recipient: form.recipient, contactPhone: form.contactPhone,
      address: form.address, note: form.note, shippingMethod: form.shippingMethod,
      freightActual: freightCheck.freight?.actual ?? null, freightPaid: freightCheck.freight?.paid ?? null, freightRecoverable: freightCheck.freight?.recoverable ?? null,
      lines: form.lines,
    };
    const result = await call(editing ? `/api/shipments/${editing}` : "/api/shipments", { method: editing ? "PUT" : "POST", body: JSON.stringify(body) }, editing ? "草稿已更新；若已產生出貨表，請再按一次「更新出貨表」。" : "草稿已建立，庫存尚未變動。");
    if (result) resetForm();
  }

  function startEdit(shipment: Shipment) {
    setEditing(shipment.id);
    setForm({
      channelId: shipment.channelId, kind: shipment.kind, plannedDate: shipment.plannedDate, recipient: shipment.recipient, contactPhone: shipment.contactPhone,
      address: shipment.address, note: shipment.note, shippingMethod: shipment.shippingMethod, freight: freightToDraft(shipment.freight),
      lines: shipment.lines.map(({ productId, quantity }) => ({ productId, quantity })),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function dispatch(shipment: Shipment) {
    const freightText = shipment.freight ? `運費：先付 ${money(shipment.freight.paid)}，向通路回收 ${money(shipment.freight.recoverable)}` : "運費：待確認（之後可補登）";
    if (!window.confirm(`確認 ${shipment.channel} 這張出貨單已實際寄出？\n會從總倉扣除 ${shipment.lines.reduce((sum, line) => sum + line.quantity, 0)} 件並建立${shipment.kind === "BUYOUT" ? "買斷" : "寄賣出貨"}異動。\n${freightText}`)) return;
    await call(`/api/shipments/${shipment.id}/dispatch`, { method: "POST" }, "已確認出貨，庫存異動已建立。");
  }

  async function remove(shipment: Shipment) {
    if (!window.confirm(`刪除 ${shipment.channel} 的出貨草稿？${shipment.sheetUrl ? "\n已產生的 Google 試算表頁籤不會自動刪除，請自行移除。" : ""}`)) return;
    await call(`/api/shipments/${shipment.id}`, { method: "DELETE" }, "草稿已刪除。");
    if (editing === shipment.id) resetForm();
  }

  async function saveFreight() {
    if (!freightEditing) return;
    const { freight, error } = parseFreight(freightEditing.value);
    if (error) return setMessage({ tone: "error", text: error });
    const result = await call(`/api/shipments/${freightEditing.id}/freight`, { method: "PUT", body: JSON.stringify({ freightActual: freight?.actual ?? null, freightPaid: freight?.paid ?? null, freightRecoverable: freight?.recoverable ?? null }) }, "運費已更新，財務支出與待請款運費已同步。");
    if (result) setFreightEditing(null);
  }

  const visible = shipments.filter((shipment) => filter === "ALL" || shipment.status === filter);
  const draftCount = shipments.filter((shipment) => shipment.status === "DRAFT").length;
  const pendingFreight = shipments.filter((shipment) => shipment.status === "DISPATCHED" && !shipment.freight).length;

  return <div className="billing-page">
    <PageHeader eyebrow="Dealer shipments" title="經銷出貨單" description="出貨前先開草稿、產生 Google 試算表出貨單校對列印；實際寄出時才一次扣庫。首批買斷預帶售價五折，運費每趟可拆「先付」與「向通路回收」。幫經銷代寄請直接在庫存異動登記寄賣出貨。" />

    <div className="billing-stats">
      <div><span>草稿</span><strong>{draftCount}</strong><small>DRAFTS</small></div>
      <div><span>已出貨</span><strong>{shipments.length - draftCount}</strong><small>DISPATCHED</small></div>
      <div><span>運費待補登</span><strong>{pendingFreight}</strong><small>FREIGHT PENDING</small></div>
    </div>

    {message && <div className={message.tone === "error" ? "form-error" : "billing-autofill-note"} role={message.tone === "error" ? "alert" : "status"}>{message.text}</div>}

    {canWrite && <form className="billing-create-grid" onSubmit={submit}>
      <div className="panel billing-form-panel">
        <div className="billing-section-head"><span>01 / DRAFT</span><h2>{editing ? "編輯出貨草稿" : "新增出貨草稿"}</h2></div>
        <div className="field"><label htmlFor="shipment-channel">經銷通路</label><select id="shipment-channel" className="select" required disabled={Boolean(editingShipment?.sheetUrl)} value={form.channelId} onChange={(event) => selectChannel(event.target.value)}><option value="">選擇通路</option>{channels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="billing-items-editor shipment-draft-products">
          <div className="shipment-draft-products-header">
            <div><strong>交易方式與商品</strong>{channel && <small>{dealLabel} · {form.lines.length} 個 SKU · {totalQuantity} 件</small>}</div>
            <button type="button" className="btn btn-secondary" disabled={!channel || busy} aria-haspopup="dialog" onClick={() => setPickerOpen(true)}>{form.lines.length ? <Pencil size={15} /> : <Plus size={15} />}{form.lines.length ? "選商品／改交易方式" : "選擇商品"}</button>
          </div>
          {!form.lines.length && <p className="shipment-draft-products-empty">{channel ? "尚未選擇商品" : "請先選擇經銷通路"}</p>}
          {form.lines.length > 0 && <ul className="shipment-draft-lines">{form.lines.map((line) => {
            const product = productById.get(line.productId);
            const saved = editingShipment?.lines.find((item) => item.productId === line.productId);
            const label = product?.sku ?? saved?.sku ?? "商品";
            return <li key={line.productId}>
              <div><strong>{product?.name ?? saved?.name ?? label}</strong><small>{[product?.size ?? saved?.size, label, !product && "商品已停用"].filter(Boolean).join(" · ")}</small></div>
              <span>× {line.quantity}</span>
              <button className="shipment-picker-icon" type="button" aria-label={`移除 ${label}`} disabled={busy} onClick={() => setForm((current) => ({ ...current, lines: current.lines.filter((item) => item.productId !== line.productId) }))}><Trash2 size={15} /></button>
            </li>;
          })}</ul>}
          {channel && form.kind === "CONSIGNMENT" && !rate && <p className="form-error">請在通路主檔設定寄賣比例，或選擇首批買斷。</p>}
          {preview.length !== form.lines.length && <p className="form-error">請移除已停用的品項後再儲存。</p>}
        </div>
        {channel && !channel.hasShippingSheet && <p className="billing-hint">此通路尚未設定出貨工作簿與範本頁籤，草稿可以先存，但要到「通路主檔」設定後才能產生試算表。</p>}
        <div className="billing-two-col">
          <div className="field"><label>預計出貨日</label><input className="input" type="date" value={form.plannedDate} onChange={(event) => setForm({ ...form, plannedDate: event.target.value })} /></div>
          <div className="field"><label>物流方式</label><input className="input" list="shipment-methods" value={form.shippingMethod} onChange={(event) => setForm({ ...form, shippingMethod: event.target.value })} placeholder="例如 黑貓宅急便" /></div>
          <div className="field"><label>收件人</label><input className="input" value={form.recipient} onChange={(event) => setForm({ ...form, recipient: event.target.value })} /></div>
          <div className="field"><label>電話</label><input className="input" value={form.contactPhone} onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} /></div>
        </div>
        <datalist id="shipment-methods">{shippingMethods.map((name) => <option key={name} value={name} />)}</datalist>
        <div className="field"><label>地址</label><input className="input" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></div>

        <div className="field"><label>備註</label><textarea className="textarea" rows={2} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></div>
      </div>

      <div className="panel billing-preview-panel">
        <div className="billing-section-head"><span>02 / PREVIEW</span><h2>出貨預覽</h2></div>
        {preview.length === 0 ? <div className="billing-empty"><strong>尚未選擇品項</strong><span>草稿不會占用庫存；確認實際出貨時才會重新檢查總倉數量。</span></div> : <>
          <div className="billing-preview-meta"><span>{preview.length} 個 SKU</span><span>{totalQuantity} 件</span><span>{dealLabel}</span>{preview.some((item) => item.short) && <span className="warn">有品項總倉不足</span>}</div>
          <div className="table-wrap billing-items"><table><thead><tr><th>SKU</th><th>品項</th><th>售價</th><th>{form.kind === "BUYOUT" ? "買斷價" : "寄賣價"}</th><th>數量</th><th>總倉</th></tr></thead><tbody>{preview.map((item) => <tr key={item.product.id}><td className="mono">{item.product.sku}</td><td>{item.product.name}{item.product.size ? ` · ${item.product.size}` : ""}</td><td>{item.retail == null ? "未設定" : money(item.retail)}</td><td>{item.trade == null ? "—" : money(item.trade)}</td><td>{item.quantity}</td><td>{item.short ? <span className="badge warn">{item.product.warehouse}</span> : item.product.warehouse}</td></tr>)}</tbody></table></div>
          {missingPrice && <div className="form-error billing-preview-error">有商品尚未設定建議售價，請先到商品主檔補上。</div>}
        </>}
        <div className="billing-items-editor">
          <div className="billing-items-editor-head"><div><span>FREIGHT</span><strong>運費</strong></div></div>
          <FreightEditor value={form.freight} onChange={(freight) => setForm({ ...form, freight })} />
        </div>
        <div className="billing-total-box">
          <div><span>件數</span><strong>{totalQuantity}</strong></div>
          <div><span>向通路回收運費</span><strong>{freightCheck.freight ? money(freightCheck.freight.recoverable) : "待確認"}</strong></div>
          <div className="grand"><span>{form.kind === "BUYOUT" ? "買斷金額" : "寄賣價合計"}</span><strong>{money(totalTrade)}</strong></div>
        </div>
        <div className="shipment-actions">
          <button className="btn btn-primary billing-create-button" type="submit" disabled={!canSave}>{busy ? "儲存中…" : editing ? "更新草稿" : "儲存草稿"}</button>
          {editing && <button type="button" className="btn btn-secondary" onClick={resetForm}>取消編輯</button>}
        </div>
      </div>
    </form>}

    {pickerOpen && channel && <ShipmentProductPicker
      channel={channel}
      initialKind={form.kind}
      initialLines={form.lines}
      products={products}
      copySources={shipments.filter((shipment) => shipment.id !== editing && shipment.lines.length).map((shipment) => ({
        id: shipment.id,
        label: `${shipment.channel} · ${shipment.plannedDate || shipment.createdDate} · ${shipment.status === "DRAFT" ? "草稿" : "已出貨"} · ${shipment.lines.length} SKU · #${shipment.id.slice(-6).toUpperCase()}`,
        lines: shipment.lines,
      }))}
      getTradePrice={(product, kind) => pricesFor(product, kind).trade}
      onApply={(kind, lines) => setForm((current) => ({ ...current, kind, lines }))}
      onDismiss={() => setPickerOpen(false)}
    />}

    <section className="billing-list-section">
      <div className="billing-list-head"><div><span>03 / SHIPMENTS</span><h2>出貨紀錄</h2></div>
        <div className="shipment-filter" role="tablist">{(["ALL", "DRAFT", "DISPATCHED"] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={filter === key} className={`btn ${filter === key ? "btn-primary" : "btn-secondary"}`} onClick={() => setFilter(key)}>{key === "ALL" ? "全部" : key === "DRAFT" ? "草稿" : "已出貨"}</button>)}</div>
      </div>
      <div className="panel table-panel"><div className="table-wrap"><table>
        <thead><tr><th>通路</th><th>類型</th><th>品項</th><th>金額</th><th>運費</th><th>日期</th><th>狀態</th><th></th></tr></thead>
        <tbody>{visible.map((shipment) => {
          const quantity = shipment.lines.reduce((sum, line) => sum + line.quantity, 0);
          const amount = round(shipment.lines.reduce((sum, line) => sum + line.tradePrice * line.quantity, 0));
          return [<tr key={shipment.id}>
            <td><strong>{shipment.channel}</strong><small className="billing-channel-name">{[shipment.recipient, shipment.shippingMethod].filter(Boolean).join(" · ") || "—"}</small></td>
            <td>{shipment.kind === "BUYOUT" ? "首批買斷" : "寄賣"}</td>
            <td title={shipment.lines.map((line) => `${line.sku} ×${line.quantity}`).join("\n")}>{shipment.lines.length} SKU / {quantity} 件</td>
            <td>{money(amount)}</td>
            <td>{shipment.freight ? <>{money(shipment.freight.recoverable)}<small className="billing-channel-name">實際 {money(shipment.freight.actual)} · 先付 {money(shipment.freight.paid)}{shipment.freightClaimed ? " · 已請款" : ""}</small></> : <span className="badge warn">待確認</span>}</td>
            <td>{shipment.dispatchedAt ? <>寄出 {new Date(shipment.dispatchedAt).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}</> : <>預計 {shipment.plannedDate || "—"}</>}</td>
            <td><span className={`badge ${shipment.status === "DISPATCHED" ? "green" : ""}`}>{shipment.status === "DRAFT" ? "草稿" : "已出貨"}</span></td>
            <td><div className="shipment-row-actions">
              {canWrite && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => call(`/api/shipments/${shipment.id}/sheet`, { method: "POST" }, "出貨表已更新。")} title="建立或更新 Google 試算表出貨單"><FileSpreadsheet size={14} />{shipment.sheetUrl ? "更新出貨表" : "產生出貨表"}</button>}
              {shipment.sheetUrl && <a className="btn btn-secondary" href={shipment.sheetUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />開啟</a>}
              {canWrite && shipment.status === "DRAFT" && <>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => startEdit(shipment)}><Pencil size={14} />編輯</button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => dispatch(shipment)}><PackageCheck size={14} />確認出貨</button>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => remove(shipment)} title="刪除草稿"><Trash2 size={14} /></button>
              </>}
              {canWrite && shipment.status === "DISPATCHED" && !shipment.freightClaimed && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setFreightEditing(freightEditing?.id === shipment.id ? null : { id: shipment.id, value: freightToDraft(shipment.freight) })}><Truck size={14} />{shipment.freight ? "修改運費" : "補登運費"}</button>}
            </div></td>
          </tr>,
          freightEditing?.id === shipment.id && <tr key={`${shipment.id}-freight`} className="shipment-freight-row"><td colSpan={8}>
            <FreightEditor value={freightEditing.value} disabled={busy} onChange={(value) => setFreightEditing({ id: shipment.id, value })} />
            <div className="shipment-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={saveFreight}>儲存運費</button><button type="button" className="btn btn-secondary" onClick={() => setFreightEditing(null)}>取消</button></div>
          </td></tr>];
        })}</tbody>
      </table></div>{visible.length === 0 && <div className="billing-empty-row">目前沒有出貨單。</div>}</div>
    </section>
  </div>;
}
