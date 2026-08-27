import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FinanceManager } from "@/components/FinanceManager";
import { PageHeader } from "@/components/ui/PageHeader";
import { getFinanceDashboard, listFinanceCategories, listFinanceTransactions } from "@/lib/services/finance";

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

function monthRange(month: string) {
  const [year, m] = month.split("-").map(Number);
  const days = new Date(year, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(days).padStart(2, "0")}` };
}

function date(value: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

export const dynamic = "force-dynamic";

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const params = await searchParams;
  const requestedMonth = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : currentMonth();
  const range = monthRange(requestedMonth);
  const [user, transactions, categories, products, dashboard] = await Promise.all([
    getCurrentUser(),
    listFinanceTransactions({ start: range.start, end: range.end, take: 300 }),
    listFinanceCategories(),
    prisma.product.findMany({ where: { active: true }, orderBy: { sku: "asc" }, select: { id: true, sku: true, name: true, size: true } }),
    getFinanceDashboard(requestedMonth),
  ]);

  return <>
    <PageHeader eyebrow="Finance" title="財務工作台" description="收支、商品營收、Excel 舊資料與對帳狀態集中管理；Finance 僅引用商品與通路，不會修改它們自己的生命週期狀態。" />
    <FinanceManager
      month={requestedMonth}
      canWrite={user?.role !== "VIEWER"}
      dashboard={dashboard}
      categories={categories}
      products={products}
      transactions={transactions.map((item) => ({
        id: item.id,
        occurredAt: date(item.occurredAt),
        direction: item.direction,
        amount: Number(item.amount),
        categoryName: item.categoryName,
        counterparty: item.counterparty,
        paymentStatus: item.paymentStatus,
        reconciliationStatus: item.reconciliationStatus,
        invoiceStatus: item.invoiceStatus,
        source: item.source,
      }))}
    />
  </>;
}
