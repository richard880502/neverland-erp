import { randomUUID } from "node:crypto";
import { Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const invoiceStatusSchema = z.enum(["MISSING", "RECEIVED", "VOIDED", "CREDITED", "NOT_REQUIRED"]);
const invoiceInputSchema = z.object({
  invoiceNo: z.string().trim().max(80).optional().nullable(),
  issuedAt: z.string().regex(datePattern).optional().nullable(),
  grossAmount: z.coerce.number().min(0).max(100_000_000).optional().nullable(),
  netAmount: z.coerce.number().min(0).max(100_000_000).optional().nullable(),
  taxAmount: z.coerce.number().min(0).max(100_000_000).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

export const financeItemSchema = z.object({
  productId: z.string().trim().min(1).optional().nullable(),
  productName: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(100).optional().nullable(),
  size: z.string().trim().max(80).optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(1_000_000).default(1),
  unitAmount: z.coerce.number().min(0).max(100_000_000).optional().nullable(),
  lineAmount: z.coerce.number().min(0).max(100_000_000),
});

export const financeCreateSchema = z.object({
  occurredAt: z.string().regex(datePattern),
  direction: z.enum(["INCOME", "EXPENSE"]),
  amount: z.coerce.number().gt(0).max(100_000_000),
  categoryId: z.string().trim().min(1).optional().nullable(),
  counterparty: z.string().trim().max(200).optional().nullable(),
  relatedParty: z.string().trim().max(200).optional().nullable(),
  salesChannel: z.string().trim().max(120).optional().nullable(),
  summary: z.string().trim().max(500).optional().nullable(),
  channelId: z.string().trim().min(1).optional().nullable(),
  paymentStatus: z.enum(["PENDING", "PARTIAL", "PAID", "REFUNDED", "VOID"]).default("PAID"),
  reconciliationStatus: z.enum(["UNMATCHED", "MATCHED", "RECONCILED"]).default("UNMATCHED"),
  invoiceStatus: invoiceStatusSchema.default("MISSING"),
  invoice: invoiceInputSchema.optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  source: z.enum(["MANUAL", "EXCEL", "BILLING", "SHOPEE", "BANK", "OTHER"]).default("MANUAL"),
  sourceRef: z.string().trim().max(200).optional().nullable(),
  legacySheet: z.string().trim().max(200).optional().nullable(),
  legacyRow: z.coerce.number().int().min(1).optional().nullable(),
  items: z.array(financeItemSchema).max(200).default([]),
});

export const financeUpdateSchema = z.object({
  paymentStatus: z.enum(["PENDING", "PARTIAL", "PAID", "REFUNDED", "VOID"]).optional(),
  reconciliationStatus: z.enum(["UNMATCHED", "MATCHED", "RECONCILED"]).optional(),
  invoiceStatus: invoiceStatusSchema.optional(),
  invoice: invoiceInputSchema.optional().nullable(),
  categoryId: z.string().trim().min(1).nullable().optional(),
  counterparty: z.string().trim().max(200).nullable().optional(),
  relatedParty: z.string().trim().max(200).nullable().optional(),
  salesChannel: z.string().trim().max(120).nullable().optional(),
  summary: z.string().trim().max(500).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

type Actor = { userId: string; role: UserRole; ipAddress?: string | null };

export type FinanceRow = {
  id: string;
  occurredAt: Date;
  direction: "INCOME" | "EXPENSE";
  amount: Prisma.Decimal;
  categoryId: string | null;
  categoryName: string | null;
  categoryParentName: string | null;
  counterparty: string | null;
  relatedParty: string | null;
  salesChannel: string | null;
  summary: string | null;
  paymentStatus: string;
  reconciliationStatus: string;
  invoiceStatus: string;
  invoiceNo: string | null;
  productNames: string[];
  source: string;
  note: string | null;
  createdAt: Date;
};

function startOfTaipeiDate(value: string) {
  return new Date(`${value}T00:00:00+08:00`);
}

function endOfTaipeiDate(value: string) {
  return new Date(`${value}T23:59:59.999+08:00`);
}

export async function listFinanceTransactions(input?: { start?: string; end?: string; direction?: "INCOME" | "EXPENSE"; take?: number }) {
  const take = Math.min(Math.max(input?.take ?? 200, 1), 500);
  const rows = await prisma.financeTransaction.findMany({
    where: {
      ...(input?.start || input?.end ? {
        occurredAt: {
          ...(input.start ? { gte: startOfTaipeiDate(input.start) } : {}),
          ...(input.end ? { lte: endOfTaipeiDate(input.end) } : {}),
        },
      } : {}),
      ...(input?.direction ? { direction: input.direction } : {}),
    },
    include: {
      category: { include: { parent: { select: { name: true } } } },
      items: { select: { productName: true } },
      invoices: { orderBy: { createdAt: "desc" }, take: 1, select: { invoiceNo: true } },
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take,
  });
  return rows.map((row): FinanceRow => ({
    id: row.id,
    occurredAt: row.occurredAt,
    direction: row.direction,
    amount: row.amount,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    categoryParentName: row.category?.parent?.name ?? null,
    counterparty: row.counterparty,
    relatedParty: row.relatedParty,
    salesChannel: row.salesChannel,
    summary: row.summary,
    paymentStatus: row.paymentStatus,
    reconciliationStatus: row.reconciliationStatus,
    invoiceStatus: row.invoiceStatus,
    invoiceNo: row.invoices[0]?.invoiceNo ?? null,
    productNames: [...new Set(row.items.map((item) => item.productName))],
    source: row.source,
    note: row.note,
    createdAt: row.createdAt,
  }));
}

export async function listFinanceCategories() {
  const rows = await prisma.financeCategory.findMany({
    where: { active: true },
    include: { parent: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    direction: row.direction,
    parentId: row.parentId,
    parentName: row.parent?.name ?? null,
  })).sort((a, b) => {
    const dir = a.direction.localeCompare(b.direction);
    if (dir) return dir;
    const group = (a.parentName ?? a.name).localeCompare(b.parentName ?? b.name, "zh-Hant");
    if (group) return group;
    if (!a.parentId && b.parentId) return -1;
    if (a.parentId && !b.parentId) return 1;
    return a.name.localeCompare(b.name, "zh-Hant");
  });
}

async function validateCategory(categoryId: string | null | undefined, direction: "INCOME" | "EXPENSE") {
  if (!categoryId) return;
  const category = await prisma.financeCategory.findUnique({
    where: { id: categoryId },
    include: { children: { where: { active: true }, select: { id: true } } },
  });
  if (!category?.active) throw new Error("找不到財務分類");
  if (category.direction !== direction) throw new Error("分類方向與收入 / 支出不一致");
  if (direction === "EXPENSE" && category.children.length > 0) throw new Error("請選擇支出細項，不要只選大分類");
}

async function resolveChannelId(input: z.infer<typeof financeCreateSchema>) {
  if (input.channelId) return input.channelId;
  if (input.direction !== "INCOME") return null;
  const candidates = [input.counterparty, input.salesChannel].filter((value): value is string => Boolean(value));
  if (!candidates.length) return null;
  const channels = await prisma.channel.findMany({ where: { active: true, name: { in: candidates } }, select: { id: true, name: true } });
  const preferred = channels.find((channel) => channel.name === input.counterparty) ?? channels.find((channel) => channel.name === input.salesChannel);
  return preferred?.id ?? null;
}

export async function createFinanceTransaction(input: z.infer<typeof financeCreateSchema>, actor: Actor) {
  if (actor.role === "VIEWER") throw new Error("目前角色沒有新增收支權限");
  await validateCategory(input.categoryId, input.direction);
  const linkedProductIds = [...new Set(input.items.map((item) => item.productId).filter((id): id is string => Boolean(id)))];
  const linkedProducts = linkedProductIds.length
    ? await prisma.product.findMany({ where: { id: { in: linkedProductIds } }, select: { id: true, unitCost: true } })
    : [];
  if (linkedProducts.length !== linkedProductIds.length) throw new Error("商品明細包含不存在的商品");
  const productCostById = new Map(linkedProducts.map((product) => [product.id, product.unitCost]));
  const channelId = await resolveChannelId(input);

  return prisma.$transaction(async (tx) => {
    const id = randomUUID();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "FinanceTransaction"
        ("id", "occurredAt", "direction", "amount", "categoryId", "counterparty", "relatedParty", "salesChannel", "summary", "channelId", "source", "sourceRef", "paymentStatus", "reconciliationStatus", "invoiceStatus", "note", "legacySheet", "legacyRow", "createdById", "updatedAt")
      VALUES
        (${id}, ${startOfTaipeiDate(input.occurredAt)}, ${input.direction}::"FinanceDirection", ${input.amount}, ${input.categoryId ?? null}, ${input.counterparty ?? null}, ${input.relatedParty ?? null}, ${input.salesChannel ?? null}, ${input.summary ?? null}, ${channelId}, ${input.source}::"FinanceSource", ${input.sourceRef ?? null}, ${input.paymentStatus}::"FinancePaymentStatus", ${input.reconciliationStatus}::"FinanceReconciliationStatus", ${input.invoiceStatus}::"FinanceInvoiceStatus", ${input.note ?? null}, ${input.legacySheet ?? null}, ${input.legacyRow ?? null}, ${actor.userId}, CURRENT_TIMESTAMP)
    `);
    for (const item of input.items) {
      const unitCostSnapshot = item.productId ? productCostById.get(item.productId) ?? null : null;
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "FinanceTransactionItem"
          ("id", "transactionId", "productId", "sku", "productName", "size", "quantity", "unitAmount", "lineAmount", "unitCostSnapshot")
        VALUES
          (${randomUUID()}, ${id}, ${item.productId ?? null}, ${item.sku ?? null}, ${item.productName}, ${item.size ?? null}, ${item.quantity}, ${item.unitAmount ?? null}, ${item.lineAmount}, ${unitCostSnapshot})
      `);
    }
    if (input.direction === "EXPENSE" && input.invoiceStatus === "RECEIVED" && input.invoice) {
      await tx.financeInvoice.create({
        data: {
          id: randomUUID(),
          transactionId: id,
          invoiceNo: input.invoice.invoiceNo ?? null,
          status: "RECEIVED",
          grossAmount: input.invoice.grossAmount ?? input.amount,
          netAmount: input.invoice.netAmount ?? null,
          taxAmount: input.invoice.taxAmount ?? null,
          issuedAt: input.invoice.issuedAt ? startOfTaipeiDate(input.invoice.issuedAt) : startOfTaipeiDate(input.occurredAt),
          note: input.invoice.note ?? null,
        },
      });
    }
    await tx.auditLog.create({ data: {
      userId: actor.userId,
      action: "FINANCE_TRANSACTION_CREATED",
      entityType: "FinanceTransaction",
      entityId: id,
      metadata: {
        direction: input.direction,
        amount: input.amount,
        categoryId: input.categoryId ?? null,
        salesChannel: input.salesChannel ?? null,
        counterparty: input.counterparty ?? null,
        relatedParty: input.relatedParty ?? null,
        source: input.source,
        itemCount: input.items.length,
        invoiceStatus: input.invoiceStatus,
      },
      ipAddress: actor.ipAddress ?? null,
    }});
    return { id };
  });
}

export async function updateFinanceTransaction(id: string, input: z.infer<typeof financeUpdateSchema>, actor: Actor) {
  if (actor.role === "VIEWER") throw new Error("目前角色沒有修改收支權限");
  const current = await prisma.financeTransaction.findUnique({ where: { id }, select: { id: true, direction: true } });
  if (!current) throw new Error("找不到收支紀錄");
  if (Object.prototype.hasOwnProperty.call(input, "categoryId")) await validateCategory(input.categoryId, current.direction);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "FinanceTransaction" SET
        "paymentStatus" = COALESCE(${input.paymentStatus ?? null}::"FinancePaymentStatus", "paymentStatus"),
        "reconciliationStatus" = COALESCE(${input.reconciliationStatus ?? null}::"FinanceReconciliationStatus", "reconciliationStatus"),
        "invoiceStatus" = COALESCE(${input.invoiceStatus ?? null}::"FinanceInvoiceStatus", "invoiceStatus"),
        "categoryId" = CASE WHEN ${Object.prototype.hasOwnProperty.call(input, "categoryId")} THEN ${input.categoryId ?? null} ELSE "categoryId" END,
        "counterparty" = CASE WHEN ${Object.prototype.hasOwnProperty.call(input, "counterparty")} THEN ${input.counterparty ?? null} ELSE "counterparty" END,
        "relatedParty" = CASE WHEN ${Object.prototype.hasOwnProperty.call(input, "relatedParty")} THEN ${input.relatedParty ?? null} ELSE "relatedParty" END,
        "salesChannel" = CASE WHEN ${Object.prototype.hasOwnProperty.call(input, "salesChannel")} THEN ${input.salesChannel ?? null} ELSE "salesChannel" END,
        "summary" = CASE WHEN ${Object.prototype.hasOwnProperty.call(input, "summary")} THEN ${input.summary ?? null} ELSE "summary" END,
        "note" = CASE WHEN ${Object.prototype.hasOwnProperty.call(input, "note")} THEN ${input.note ?? null} ELSE "note" END,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}
    `);

    const existingInvoice = await tx.financeInvoice.findFirst({ where: { transactionId: id }, orderBy: { createdAt: "desc" } });
    if (current.direction === "EXPENSE" && input.invoice) {
      const invoiceData = {
        invoiceNo: input.invoice.invoiceNo ?? null,
        status: input.invoiceStatus ?? "RECEIVED" as const,
        grossAmount: input.invoice.grossAmount ?? null,
        netAmount: input.invoice.netAmount ?? null,
        taxAmount: input.invoice.taxAmount ?? null,
        issuedAt: input.invoice.issuedAt ? startOfTaipeiDate(input.invoice.issuedAt) : null,
        note: input.invoice.note ?? null,
      };
      if (existingInvoice) await tx.financeInvoice.update({ where: { id: existingInvoice.id }, data: invoiceData });
      else await tx.financeInvoice.create({ data: { id: randomUUID(), transactionId: id, ...invoiceData } });
    } else if (existingInvoice && input.invoiceStatus) {
      await tx.financeInvoice.update({ where: { id: existingInvoice.id }, data: { status: input.invoiceStatus } });
    }

    await tx.auditLog.create({ data: {
      userId: actor.userId,
      action: "FINANCE_TRANSACTION_UPDATED",
      entityType: "FinanceTransaction",
      entityId: id,
      metadata: input,
      ipAddress: actor.ipAddress ?? null,
    }});
  });
  return { id };
}

export async function getFinanceTransactionDetail(id: string) {
  const row = await prisma.financeTransaction.findUnique({
    where: { id },
    include: {
      category: { include: { parent: { select: { id: true, code: true, name: true } } } },
      items: { orderBy: { createdAt: "asc" } },
      invoices: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!row) return null;

  const productIds = [...new Set(row.items.map((item) => item.productId).filter((value): value is string => Boolean(value)))];
  const relatedOr: Prisma.FinanceTransactionWhereInput[] = [];
  if (row.counterparty) relatedOr.push({ counterparty: row.counterparty });
  if (row.relatedParty) relatedOr.push({ relatedParty: row.relatedParty });
  if (productIds.length) relatedOr.push({ items: { some: { productId: { in: productIds } } } });
  const related = relatedOr.length ? await prisma.financeTransaction.findMany({
    where: { id: { not: id }, OR: relatedOr },
    include: { category: { include: { parent: { select: { name: true } } } } },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: 8,
  }) : [];

  return {
    id: row.id,
    occurredAt: row.occurredAt,
    direction: row.direction,
    amount: Number(row.amount),
    categoryName: row.category?.name ?? null,
    categoryParentName: row.category?.parent?.name ?? null,
    counterparty: row.counterparty,
    relatedParty: row.relatedParty,
    salesChannel: row.salesChannel,
    summary: row.summary,
    paymentStatus: row.paymentStatus,
    reconciliationStatus: row.reconciliationStatus,
    invoiceStatus: row.invoiceStatus,
    source: row.source,
    sourceRef: row.sourceRef,
    note: row.note,
    legacySheet: row.legacySheet,
    legacyRow: row.legacyRow,
    items: row.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      sku: item.sku,
      productName: item.productName,
      size: item.size,
      quantity: item.quantity,
      unitAmount: item.unitAmount === null ? null : Number(item.unitAmount),
      lineAmount: Number(item.lineAmount),
      unitCostSnapshot: item.unitCostSnapshot === null ? null : Number(item.unitCostSnapshot),
    })),
    invoices: row.invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      status: invoice.status,
      grossAmount: invoice.grossAmount === null ? null : Number(invoice.grossAmount),
      netAmount: invoice.netAmount === null ? null : Number(invoice.netAmount),
      taxAmount: invoice.taxAmount === null ? null : Number(invoice.taxAmount),
      issuedAt: invoice.issuedAt,
      note: invoice.note,
    })),
    related: related.map((item) => ({
      id: item.id,
      occurredAt: item.occurredAt,
      direction: item.direction,
      amount: Number(item.amount),
      categoryName: item.category?.name ?? null,
      categoryParentName: item.category?.parent?.name ?? null,
      counterparty: item.counterparty,
      relatedParty: item.relatedParty,
      salesChannel: item.salesChannel,
      summary: item.summary,
    })),
  };
}

export async function getFinanceDashboard(month: string) {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error("月份格式錯誤");
  const year = Number(match[1]);
  const mon = Number(match[2]);
  const start = new Date(`${month}-01T00:00:00+08:00`);
  const nextMonth = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, "0")}-01`;
  const end = new Date(`${nextMonth}T00:00:00+08:00`);

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
  };
}
