import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { BillingDetailActions } from "@/components/BillingDetailActions";

const statusLabels = { DRAFT: "草稿", ISSUED: "待收款", PAID: "已收款", VOID: "已作廢" } as const;
function date(value: Date | null) { return value ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value) : "—"; }
function money(value: number) { return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 2 }).format(value); }

export default async function BillingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [statement, user] = await Promise.all([
    prisma.billingStatement.findUnique({ where: { id }, include: { channel: true, items: { orderBy: { sku: "asc" } }, createdBy: { select: { name: true } } } }),
    getCurrentUser(),
  ]);
  if (!statement) notFound();
  return <div className="billing-detail">
    <Link className="inventory-back" href="/billing"><ArrowLeft size={15} />返回請款管理</Link>
    <PageHeader eyebrow={statement.statementNo} title={statement.companyName} description={`${date(statement.periodStart)} ～ ${date(statement.periodEnd)} · ${statement.sourceType === "CONSIGNMENT" ? "寄賣結算" : "買斷結算"}`} actions={<BillingDetailActions id={statement.id} totalAmount={Number(statement.totalAmount)} status={statement.status} canWrite={user?.role !== "VIEWER"} />} />
    <div className="billing-detail-meta">
      <div><span>狀態</span><strong><span className={`badge billing-status-${statement.status.toLowerCase()}`}>{statusLabels[statement.status]}</span></strong></div>
      <div><span>請款日期</span><strong>{date(statement.issuedAt)}</strong></div>
      <div><span>付款期限</span><strong>{date(statement.dueDate)}</strong></div>
      <div><span>請款總額</span><strong>{money(Number(statement.totalAmount))}</strong></div>
    </div>
    <div className="billing-detail-grid">
      <section className="panel"><div className="billing-section-head"><span>CUSTOMER SNAPSHOT</span><h2>客戶資料</h2></div><dl className="billing-snapshot"><div><dt>通路</dt><dd>{statement.channel.name}</dd></div><div><dt>公司名稱</dt><dd>{statement.companyName}</dd></div><div><dt>統一編號</dt><dd>{statement.taxId || "—"}</dd></div><div><dt>聯絡人</dt><dd>{statement.contactName || "—"}</dd></div><div><dt>電話</dt><dd>{statement.contactPhone || "—"}</dd></div><div><dt>Email</dt><dd>{statement.contactEmail || "—"}</dd></div><div className="wide"><dt>地址</dt><dd>{statement.billingAddress || "—"}</dd></div></dl></section>
      <section className="panel"><div className="billing-section-head"><span>SETTLEMENT</span><h2>結算資訊</h2></div><div className="billing-total-box compact"><div><span>結算比例</span><strong>{Number(statement.settlementRate) * 100}%</strong></div><div><span>未稅金額</span><strong>{money(Number(statement.subtotal))}</strong></div><div><span>營業稅 {Number(statement.taxRate) * 100}%</span><strong>{money(Number(statement.taxAmount))}</strong></div><div><span>運費</span><strong>{money(Number(statement.shippingFee))}</strong></div><div className="grand"><span>請款總額</span><strong>{money(Number(statement.totalAmount))}</strong></div></div></section>
    </div>
    <section className="billing-list-section"><div className="billing-list-head"><div><span>ITEM SNAPSHOT</span><h2>請款明細</h2></div><small>建立人：{statement.createdBy.name}</small></div><div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>SKU</th><th>品項名稱</th><th>尺寸</th><th>建議售價</th><th>結算價</th><th>數量</th><th>小計</th></tr></thead><tbody>{statement.items.map((item) => <tr key={item.id}><td className="mono">{item.sku}</td><td>{item.productName}</td><td>{item.size || "—"}</td><td>{money(Number(item.listPrice))}</td><td>{money(Number(item.settlementPrice))}</td><td>{item.quantity}</td><td>{money(Number(item.subtotal))}</td></tr>)}</tbody></table></div></div></section>
    {statement.status === "PAID" && <section className="panel billing-payment-record"><div className="billing-section-head"><span>PAYMENT</span><h2>收款紀錄</h2></div><div className="billing-detail-meta"><div><span>收款日期</span><strong>{date(statement.paidAt)}</strong></div><div><span>收款金額</span><strong>{money(Number(statement.paidAmount ?? 0))}</strong></div><div><span>付款方式</span><strong>{statement.paymentMethod || "—"}</strong></div><div><span>參考號</span><strong>{statement.paymentReference || "—"}</strong></div></div></section>}
  </div>;
}
