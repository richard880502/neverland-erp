import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function monthIndex(month: string) {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error("月份格式錯誤");
  const year = Number(match[1]);
  const mon = Number(match[2]);
  if (mon < 1 || mon > 12) throw new Error("月份格式錯誤");
  return year * 12 + mon - 1;
}

function monthFromIndex(index: number) {
  const year = Math.floor(index / 12);
  const mon = index % 12 + 1;
  return `${year}-${String(mon).padStart(2, "0")}`;
}

function monthLastDay(month: string) {
  const [year, mon] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(year, mon, 0)).getUTCDate()).padStart(2, "0")}`;
}

function monthsBetween(startDate: string, endDate: string) {
  const startIndex = monthIndex(startDate.slice(0, 7));
  const endIndex = monthIndex(endDate.slice(0, 7));
  return Array.from({ length: endIndex - startIndex + 1 }, (_, index) => monthFromIndex(startIndex + index));
}

function validateDate(value: string) {
  if (!datePattern.test(value)) throw new Error("日期格式錯誤");
  const parsed = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("日期格式錯誤");
  return parsed;
}

function nextTaipeiDate(value: string) {
  const date = validateDate(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export function financePeriodRange(endMonth: string, months: number) {
  const safeMonths = [1, 3, 6, 12, 24].includes(months) ? months : 3;
  const endIndex = monthIndex(endMonth);
  const startMonth = monthFromIndex(endIndex - safeMonths + 1);
  const nextMonth = monthFromIndex(endIndex + 1);
  return {
    months: safeMonths,
    startMonth,
    endMonth,
    startDate: `${startMonth}-01`,
    endDateExclusive: `${nextMonth}-01`,
    start: new Date(`${startMonth}-01T00:00:00+08:00`),
    end: new Date(`${nextMonth}-01T00:00:00+08:00`),
  };
}

export async function getFinanceDashboardByDates(startDate: string, endDate: string) {
  const start = validateDate(startDate);
  const inclusiveEnd = validateDate(endDate);
  if (start > inclusiveEnd) throw new Error("開始日期不能晚於結束日期");
  const end = nextTaipeiDate(endDate);

  const [
    totals,
    expenseSplit,
    cogsRows,
    topProducts,
    topCategories,
    topChannels,
    monthlyRevenueRows,
    monthlyOperatingRows,
    monthlyCogsRows,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{
      grossRevenue: Prisma.Decimal;
      refunds: Prisma.Decimal;
      netRevenue: Prisma.Decimal;
      totalExpense: Prisma.Decimal;
      receivable: Prisma.Decimal;
      cashIncome: Prisma.Decimal;
      cashExpense: Prisma.Decimal;
      missingExpenseInvoices: bigint;
    }>>(Prisma.sql`
      SELECT
        COALESCE(SUM(CASE WHEN "direction" = 'INCOME' AND "paymentStatus" <> 'VOID' THEN "amount" ELSE 0 END), 0) AS "grossRevenue",
        COALESCE(SUM(CASE WHEN "direction" = 'INCOME' AND "paymentStatus" = 'REFUNDED' THEN "amount" ELSE 0 END), 0) AS "refunds",
        COALESCE(SUM(CASE WHEN "direction" = 'INCOME' AND "paymentStatus" NOT IN ('VOID','REFUNDED') THEN "amount" ELSE 0 END), 0) AS "netRevenue",
        COALESCE(SUM(CASE WHEN "direction" = 'EXPENSE' AND "paymentStatus" NOT IN ('VOID','REFUNDED') THEN "amount" ELSE 0 END), 0) AS "totalExpense",
        COALESCE(SUM(CASE WHEN "direction" = 'INCOME' AND "paymentStatus" IN ('PENDING','PARTIAL') THEN "amount" ELSE 0 END), 0) AS "receivable",
        COALESCE(SUM(CASE WHEN "direction" = 'INCOME' AND "paymentStatus" = 'PAID' THEN "amount" ELSE 0 END), 0) AS "cashIncome",
        COALESCE(SUM(CASE WHEN "direction" = 'EXPENSE' AND "paymentStatus" = 'PAID' THEN "amount" ELSE 0 END), 0) AS "cashExpense",
        COUNT(*) FILTER (WHERE "direction" = 'EXPENSE' AND "paymentStatus" <> 'VOID' AND "invoiceStatus" = 'MISSING') AS "missingExpenseInvoices"
      FROM "FinanceTransaction"
      WHERE "occurredAt" >= ${start} AND "occurredAt" < ${end}
    `),
    prisma.$queryRaw<Array<{ inventorySpend: Prisma.Decimal; operatingExpense: Prisma.Decimal }>>(Prisma.sql`
      SELECT
        COALESCE(SUM(CASE WHEN COALESCE(p."code", c."code") = 'expense_product_cost' THEN t."amount" ELSE 0 END), 0) AS "inventorySpend",
        COALESCE(SUM(CASE WHEN COALESCE(p."code", c."code") <> 'expense_product_cost' OR COALESCE(p."code", c."code") IS NULL THEN t."amount" ELSE 0 END), 0) AS "operatingExpense"
      FROM "FinanceTransaction" t
      LEFT JOIN "FinanceCategory" c ON c."id" = t."categoryId"
      LEFT JOIN "FinanceCategory" p ON p."id" = c."parentId"
      WHERE t."occurredAt" >= ${start} AND t."occurredAt" < ${end}
        AND t."direction" = 'EXPENSE'
        AND t."paymentStatus" NOT IN ('VOID','REFUNDED')
    `),
    prisma.$queryRaw<Array<{ cogs: Prisma.Decimal; costedRevenue: Prisma.Decimal }>>(Prisma.sql`
      SELECT
        COALESCE(SUM(CASE WHEN i."unitCostSnapshot" IS NOT NULL THEN i."quantity" * i."unitCostSnapshot" ELSE 0 END), 0) AS "cogs",
        COALESCE(SUM(CASE WHEN i."unitCostSnapshot" IS NOT NULL THEN i."lineAmount" ELSE 0 END), 0) AS "costedRevenue"
      FROM "FinanceTransactionItem" i
      JOIN "FinanceTransaction" t ON t."id" = i."transactionId"
      WHERE t."occurredAt" >= ${start} AND t."occurredAt" < ${end}
        AND t."direction" = 'INCOME'
        AND t."paymentStatus" NOT IN ('VOID','REFUNDED')
    `),
    prisma.$queryRaw<Array<{ productId: string | null; productName: string; revenue: Prisma.Decimal; quantity: bigint }>>(Prisma.sql`
      SELECT i."productId", i."productName", COALESCE(SUM(i."lineAmount"),0) AS "revenue", COALESCE(SUM(i."quantity"),0) AS "quantity"
      FROM "FinanceTransactionItem" i JOIN "FinanceTransaction" t ON t."id" = i."transactionId"
      WHERE t."occurredAt" >= ${start} AND t."occurredAt" < ${end} AND t."direction" = 'INCOME' AND t."paymentStatus" NOT IN ('VOID','REFUNDED')
      GROUP BY i."productId", i."productName" ORDER BY "revenue" DESC LIMIT 8
    `),
    prisma.$queryRaw<Array<{ name: string; amount: Prisma.Decimal }>>(Prisma.sql`
      SELECT COALESCE(parent."name", c."name", '未分類') AS "name", COALESCE(SUM(t."amount"),0) AS "amount"
      FROM "FinanceTransaction" t
      LEFT JOIN "FinanceCategory" c ON c."id" = t."categoryId"
      LEFT JOIN "FinanceCategory" parent ON parent."id" = c."parentId"
      WHERE t."occurredAt" >= ${start} AND t."occurredAt" < ${end} AND t."direction" = 'EXPENSE' AND t."paymentStatus" NOT IN ('VOID','REFUNDED')
      GROUP BY COALESCE(parent."name", c."name", '未分類') ORDER BY "amount" DESC LIMIT 8
    `),
    prisma.$queryRaw<Array<{ name: string; amount: Prisma.Decimal }>>(Prisma.sql`
      SELECT COALESCE(NULLIF("salesChannel", ''), '未指定') AS "name", COALESCE(SUM("amount"),0) AS "amount"
      FROM "FinanceTransaction"
      WHERE "occurredAt" >= ${start} AND "occurredAt" < ${end} AND "direction" = 'INCOME' AND "paymentStatus" NOT IN ('VOID','REFUNDED')
      GROUP BY COALESCE(NULLIF("salesChannel", ''), '未指定') ORDER BY "amount" DESC LIMIT 8
    `),
    prisma.$queryRaw<Array<{ month: string; netRevenue: Prisma.Decimal }>>(Prisma.sql`
      SELECT
        to_char(date_trunc('month', t."occurredAt" AT TIME ZONE 'Asia/Taipei'), 'YYYY-MM') AS "month",
        COALESCE(SUM(t."amount"), 0) AS "netRevenue"
      FROM "FinanceTransaction" t
      WHERE t."occurredAt" >= ${start} AND t."occurredAt" < ${end}
        AND t."direction" = 'INCOME'
        AND t."paymentStatus" NOT IN ('VOID','REFUNDED')
      GROUP BY 1 ORDER BY 1
    `),
    prisma.$queryRaw<Array<{ month: string; operatingExpense: Prisma.Decimal }>>(Prisma.sql`
      SELECT
        to_char(date_trunc('month', t."occurredAt" AT TIME ZONE 'Asia/Taipei'), 'YYYY-MM') AS "month",
        COALESCE(SUM(t."amount"), 0) AS "operatingExpense"
      FROM "FinanceTransaction" t
      LEFT JOIN "FinanceCategory" c ON c."id" = t."categoryId"
      LEFT JOIN "FinanceCategory" p ON p."id" = c."parentId"
      WHERE t."occurredAt" >= ${start} AND t."occurredAt" < ${end}
        AND t."direction" = 'EXPENSE'
        AND t."paymentStatus" NOT IN ('VOID','REFUNDED')
        AND (COALESCE(p."code", c."code") <> 'expense_product_cost' OR COALESCE(p."code", c."code") IS NULL)
      GROUP BY 1 ORDER BY 1
    `),
    prisma.$queryRaw<Array<{ month: string; cogs: Prisma.Decimal }>>(Prisma.sql`
      SELECT
        to_char(date_trunc('month', t."occurredAt" AT TIME ZONE 'Asia/Taipei'), 'YYYY-MM') AS "month",
        COALESCE(SUM(CASE WHEN i."unitCostSnapshot" IS NOT NULL THEN i."quantity" * i."unitCostSnapshot" ELSE 0 END), 0) AS "cogs"
      FROM "FinanceTransactionItem" i
      JOIN "FinanceTransaction" t ON t."id" = i."transactionId"
      WHERE t."occurredAt" >= ${start} AND t."occurredAt" < ${end}
        AND t."direction" = 'INCOME'
        AND t."paymentStatus" NOT IN ('VOID','REFUNDED')
      GROUP BY 1 ORDER BY 1
    `),
  ]);

  const total = totals[0] ?? {
    grossRevenue: new Prisma.Decimal(0), refunds: new Prisma.Decimal(0), netRevenue: new Prisma.Decimal(0), totalExpense: new Prisma.Decimal(0),
    receivable: new Prisma.Decimal(0), cashIncome: new Prisma.Decimal(0), cashExpense: new Prisma.Decimal(0), missingExpenseInvoices: BigInt(0),
  };
  const expense = expenseSplit[0] ?? { inventorySpend: new Prisma.Decimal(0), operatingExpense: new Prisma.Decimal(0) };
  const cost = cogsRows[0] ?? { cogs: new Prisma.Decimal(0), costedRevenue: new Prisma.Decimal(0) };
  const netRevenue = Number(total.netRevenue);
  const cogs = Number(cost.cogs);
  const operatingExpense = Number(expense.operatingExpense);
  const grossProfit = netRevenue - cogs;
  const estimatedNetProfit = grossProfit - operatingExpense;
  const costCoverage = netRevenue > 0 ? Math.min(100, Number(cost.costedRevenue) / netRevenue * 100) : 100;

  const revenueByMonth = new Map(monthlyRevenueRows.map((row) => [row.month, Number(row.netRevenue)]));
  const operatingByMonth = new Map(monthlyOperatingRows.map((row) => [row.month, Number(row.operatingExpense)]));
  const cogsByMonth = new Map(monthlyCogsRows.map((row) => [row.month, Number(row.cogs)]));
  const trend = monthsBetween(startDate, endDate).map((month) => {
    const monthRevenue = revenueByMonth.get(month) ?? 0;
    const monthCogs = cogsByMonth.get(month) ?? 0;
    const monthOperating = operatingByMonth.get(month) ?? 0;
    const monthGrossProfit = monthRevenue - monthCogs;
    return {
      month,
      netRevenue: monthRevenue,
      grossProfit: monthGrossProfit,
      estimatedNetProfit: monthGrossProfit - monthOperating,
      partial: startDate > `${month}-01` || endDate < monthLastDay(month),
    };
  });

  return {
    income: netRevenue,
    expense: Number(total.totalExpense),
    cashFlow: Number(total.cashIncome) - Number(total.cashExpense),
    receivable: Number(total.receivable),
    grossRevenue: Number(total.grossRevenue),
    refunds: Number(total.refunds),
    netRevenue,
    cogs,
    inventorySpend: Number(expense.inventorySpend),
    operatingExpense,
    grossProfit,
    estimatedNetProfit,
    profitMargin: netRevenue > 0 ? estimatedNetProfit / netRevenue * 100 : 0,
    costCoverage,
    missingExpenseInvoices: Number(total.missingExpenseInvoices),
    topProducts: topProducts.map((item) => ({ ...item, revenue: Number(item.revenue), quantity: Number(item.quantity) })),
    topCategories: topCategories.map((item) => ({ ...item, amount: Number(item.amount) })),
    topChannels: topChannels.map((item) => ({ ...item, amount: Number(item.amount) })),
    trend,
    period: { startDate, endDate },
  };
}

export async function getFinanceDashboardRange(endMonth: string, months = 3) {
  const range = financePeriodRange(endMonth, months);
  const endDate = new Date(range.end.getTime() - 1);
  const endDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(endDate);
  return getFinanceDashboardByDates(range.startDate, endDay);
}
