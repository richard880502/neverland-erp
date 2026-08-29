import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FinanceManager } from "@/components/FinanceManager";
import { PageHeader } from "@/components/ui/PageHeader";
import { listFinanceCategories, listFinanceTransactions } from "@/lib/services/finance";
import { financePeriodRange, getFinanceDashboardRange } from "@/lib/services/finance-range";

const allowedPeriodMonths = new Set([1, 3, 6, 12, 24]);

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

function monthEnd(month: string) {
  const [year, m] = month.split("-").map(Number);
  const days = new Date(year, m, 0).getDate();
  return `${month}-${String(days).padStart(2, "0")}`;
}

function date(value: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

export const dynamic = "force-dynamic";

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ month?: string; months?: string }> }) {
  const params = await searchParams;
  const requestedMonth = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : currentMonth();
  const requestedMonths = Number(params.months ?? "3");
  const periodMonths = allowedPeriodMonths.has(requestedMonths) ? requestedMonths : 3;
  const range = financePeriodRange(requestedMonth, periodMonths);

  const [user, transactions, categories, products, channels, dashboard] = await Promise.all([
    getCurrentUser(),
    listFinanceTransactions({ start: range.startDate, end: monthEnd(requestedMonth), take: 500 }),
    listFinanceCategories(),
    prisma.product.findMany({ where: { active: true }, orderBy: { sku: "asc" }, select: { id: true, sku: true, name: true, size: true } }),
    prisma.channel.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
    getFinanceDashboardRange(requestedMonth, periodMonths),
  ]);

  const periodDescription = periodMonths === 1
    ? "先看本月到底賺不賺錢，再從查帳直接找到對應商品、店家、用途、發票與金額。支出發票是主要憑證追蹤對象。"
    : `目前顯示 ${range.startMonth} ～ ${range.endMonth} 共 ${periodMonths} 個月；損益、排行與查帳都使用同一區間。`;

  return <>
    <PageHeader eyebrow="Finance" title="財務工作台" description={periodDescription} />
    <FinanceManager
      month={requestedMonth}
      months={periodMonths}
      canWrite={user?.role !== "VIEWER"}
      dashboard={dashboard}
      categories={categories}
      products={products}
      channels={channels}
      transactions={transactions.map((item) => ({
        id: item.id,
        occurredAt: date(item.occurredAt),
        direction: item.direction,
        amount: Number(item.amount),
        categoryName: item.categoryName,
        categoryParentName: item.categoryParentName,
        counterparty: item.counterparty,
        relatedParty: item.relatedParty,
        salesChannel: item.salesChannel,
        summary: item.summary,
        paymentStatus: item.paymentStatus,
        reconciliationStatus: item.reconciliationStatus,
        invoiceStatus: item.invoiceStatus,
        invoiceNo: item.invoiceNo,
        productNames: item.productNames,
        source: item.source,
      }))}
    />
  </>;
}
