import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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

export async function getFinanceDashboardRange(endMonth: string, months = 3) {
  const range = financePeriodRange(endMonth, months);
  const { start, end } = range;

  const [totals, expenseSplit, cogsRows, topProducts, topCategories, topChannels] = await Promise.all([
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
    period: {
      months: range.months,
      startMonth: range.startMonth,
      endMonth: range.endMonth,
    },
  };
}
