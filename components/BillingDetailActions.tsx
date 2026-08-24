"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Download, FileSpreadsheet, WalletCards } from "lucide-react";

function today() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function BillingDetailActions({ id, totalAmount, status, canWrite }: { id: string; totalAmount: number; status: string; canWrite: boolean }) {
  const router = useRouter();
  const [showPaid, setShowPaid] = useState(false);
  const [paidAt, setPaidAt] = useState(today());
  const [paidAmount, setPaidAmount] = useState(String(totalAmount));
  const [paymentMethod, setPaymentMethod] = useState("銀行轉帳");
  const [paymentReference, setPaymentReference] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [voiding, setVoiding] = useState(false);

  async function markPaid() {
    setLoading(true); setMessage("");
    const response = await fetch(`/api/billing/${id}/paid`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paidAt, paidAmount: Number(paidAmount), paymentMethod, paymentReference: paymentReference || null }) });
    const result = await response.json(); setLoading(false);
    if (!response.ok) return setMessage(result.error ?? "收款登記失敗");
    setShowPaid(false); router.refresh();
  }

  async function voidStatement() {
    if (!confirm("確定作廢這張請款單？作廢後不再計入應收，原本綁定的銷售紀錄會重新變成可請款。")) return;
    setVoiding(true); setMessage("");
    const response = await fetch(`/api/billing/${id}/void`, { method: "POST" });
    const result = await response.json(); setVoiding(false);
    if (!response.ok) return setMessage(result.error ?? "請款單作廢失敗");
    setShowPaid(false); router.refresh();
  }

  return <div className="billing-actions-stack">
    <div className="header-actions">
      <a className="btn btn-secondary" href={`/api/billing/${id}/export/xlsx`}><FileSpreadsheet size={15} />匯出 XLSX</a>
      <a className="btn btn-secondary" href={`/api/billing/${id}/export/pdf`}><Download size={15} />匯出 PDF</a>
      {canWrite && status === "ISSUED" && <button className="btn btn-danger" disabled={voiding} onClick={voidStatement}><Ban size={15} />{voiding ? "作廢中…" : "作廢請款單"}</button>}
      {canWrite && status !== "PAID" && status !== "VOID" && <button className="btn btn-primary" onClick={() => setShowPaid((value) => !value)}><WalletCards size={15} />標記已收款</button>}
    </div>
    {message && !showPaid && <div className="form-error billing-action-error">{message}</div>}
    {showPaid && <div className="panel billing-paid-panel">
      {message && <div className="form-error">{message}</div>}
      <div className="billing-two-col"><div className="field"><label>收款日期</label><input className="input" type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></div><div className="field"><label>收款金額</label><input className="input" type="number" min="0" step="0.01" value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} /></div><div className="field"><label>付款方式</label><input className="input" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} /></div><div className="field"><label>匯款末五碼 / 參考號</label><input className="input" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></div></div>
      <button className="btn btn-primary" disabled={loading} onClick={markPaid}>{loading ? "儲存中…" : "確認收款"}</button>
    </div>}
  </div>;
}
