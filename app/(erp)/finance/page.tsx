import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FinanceManager } from "@/components/FinanceManager";
import { PageHeader } from "@/components/ui/PageHeader";
import { listFinanceCategories, listFinanceTransactions } from "@/lib/services/finance";
import { getFinanceDashboardByDates } from "@/lib/services/finance-range";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const periodLabels = {
  "this-month": "本月",
  "last-month": "上個月",
  "3m": "近 3 個月",
  "6m": "近 6 個月",
  "12m": "近 12 個月",
  "24m": "近 24 個月",
  "this-year": "今年",
  "last-year": "去年",
  custom: "自訂區間",
} as const;
type PeriodPreset = keyof typeof periodLabels;

function todayTaipei() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function shiftMonth(month: string, delta: number) {
  const [year, mon] = month.split("-").map(Number);
  const index = year * 12 + mon - 1 + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = index % 12 + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

function monthEnd(month: string) {
  const [year, mon] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return `${month}-${String(days).padStart(2, "0")}`;
}

function resolvePeriod(params: { period?: string; start?: string; end?: string }) {
  const today = todayTaipei();
  const currentMonth = today.slice(0, 7);
  const currentYear = Number(today.slice(0, 4));
  const requestedPreset = params.period && params.period in periodLabels ? params.period as PeriodPreset : "3m";

  if (requestedPreset === "custom") {
    const validStart = params.start && datePattern.test(params.start) ? params.start : null;
    const validEnd = params.end && datePattern.test(params.end) ? params.end : null;
    if (validStart && validEnd && validStart <= validEnd) {
      return { preset: requestedPreset, label: periodLabels[requestedPreset], startDate: validStart, endDate: validEnd };
    }
  }

  if (requestedPreset === "this-month") return { preset: requestedPreset, label: periodLabels[requestedPreset], startDate: `${currentMonth}-01`, endDate: today };
  if (requestedPreset === "last-month") {
    const month = shiftMonth(currentMonth, -1);
    return { preset: requestedPreset, label: periodLabels[requestedPreset], startDate: `${month}-01`, endDate: monthEnd(month) };
  }
  if (requestedPreset === "this-year") return { preset: requestedPreset, label: periodLabels[requestedPreset], startDate: `${currentYear}-01-01`, endDate: today };
  if (requestedPreset === "last-year") return { preset: requestedPreset, label: periodLabels[requestedPreset], startDate: `${currentYear - 1}-01-01`, endDate: `${currentYear - 1}-12-31` };

  const months = requestedPreset === "6m" ? 6 : requestedPreset === "12m" ? 12 : requestedPreset === "24m" ? 24 : 3;
  const startMonth = shiftMonth(currentMonth, -(months - 1));
  const preset = requestedPreset === "custom" ? "3m" : requestedPreset;
  return { preset, label: periodLabels[preset], startDate: `${startMonth}-01`, endDate: today };
}

function date(value: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

export const dynamic = "force-dynamic";

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ period?: string; start?: string; end?: string }> }) {
  const params = await searchParams;
  const period = resolvePeriod(params);

  const [user, transactions, categories, products, channels, dashboard] = await Promise.all([
    getCurrentUser(),
    listFinanceTransactions({ start: period.startDate, end: period.endDate, take: 500 }),
    listFinanceCategories(),
    prisma.product.findMany({ where: { active: true }, orderBy: { sku: "asc" }, select: { id: true, sku: true, name: true, size: true } }),
    prisma.channel.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
    getFinanceDashboardByDates(period.startDate, period.endDate),
  ]);

  const periodDescription = `目前顯示 ${period.startDate} ～ ${period.endDate}（${period.label}）；損益、排行與查帳都使用同一日期區間。`;

  return <>
    <PageHeader eyebrow="Finance" title="財務工作台" description={periodDescription} />
    <FinanceManager
      period={period.preset}
      periodLabel={period.label}
      startDate={period.startDate}
      endDate={period.endDate}
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
