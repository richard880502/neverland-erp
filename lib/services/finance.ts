import { randomUUID } from "node:crypto";
import { Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

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
  invoiceStatus: z.enum(["MISSING", "RECEIVED", "VOIDED", "CREDITED"]).default("MISSING"),
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
  invoiceStatus: z.enum(["MISSING", "RECEIVED", "VOIDED", "CREDITED"]).optional(),
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
  const conditions: Prisma.Sql[] = [];
  if (input?.start) conditions.push(Prisma.sql`t."occurredAt" >= ${startOfTaipeiDate(input.start)}`);
  if (input?.end) conditions.push(Prisma.sql`t."occurredAt" <= ${endOfTaipeiDate(input.end)}`);
  if (input?.direction) conditions.push(Prisma.sql`t."direction" = ${input.direction}::"FinanceDirection"`);
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  return prisma.$queryRaw<FinanceRow[]>(Prisma.sql`
    SELECT t."id", t."occurredAt", t."direction", t."amount", t."categoryId",
           c."name" AS "categoryName", p."name" AS "categoryParentName",
           t."counterparty", t."relatedParty", t."salesChannel", t."summary",
           t."paymentStatus", t."reconciliationStatus", t."invoiceStatus",
           t."source", t."note", t."createdAt"
    FROM "FinanceTransaction" t
    LEFT JOIN "FinanceCategory" c ON c."id" = t."categoryId"
    LEFT JOIN "FinanceCategory" p ON p."id" = c."parentId"
    ${where}
    ORDER BY t."occurredAt" DESC, t."createdAt" DESC
    LIMIT ${take}
  `);
}

export async function listFinanceCategories() {
  return prisma.$queryRaw<Array<{ id: string; code: string; name: string; direction: "INCOME" | "EXPENSE"; parentId: string | null; parentName: string | null }>>(Prisma.sql`
    SELECT c."id", c."code", c."name", c."direction", c."parentId", p."name" AS "parentName"
    FROM "FinanceCategory" c
    LEFT JOIN "FinanceCategory" p ON p."id" = c."parentId"
    WHERE c."active" = true
    ORDER BY c."direction", COALESCE(p."name", c."name"), CASE WHEN c."parentId" IS NULL THEN 0 ELSE 1 END, c."name"
  `);
}

async function validateCategory(categoryId: string | null | undefined, direction: "INCOME" | "EXPENSE") {
  if (!categoryId) return;
  const categories = await prisma.$queryRaw<Array<{ direction: string; childCount: bigint }>>(Prisma.sql`
    SELECT c."direction", COUNT(child."id") AS "childCount"
    FROM "FinanceCategory" c
    LEFT JOIN "FinanceCategory" child ON child."parentId" = c."id" AND child."active" = true
    WHERE c."id" = ${categoryId} AND c."active" = true
    GROUP BY c."id", c."direction"
    LIMIT 1
  `);
  if (!categories[0]) throw new Error("找不到財務分類");
  if (categories[0].direction !== direction) throw new Error("分類方向與收入 / 支出不一致");
  if (direction === "EXPENSE" && Number(categories[0].childCount) > 0) throw new Error("請選擇支出細項，不要只選大分類");
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
  if (linkedProductIds.length) {
    const count = await prisma.product.count({ where: { id: { in: linkedProductIds } } });
    if (count !== linkedProductIds.length) throw new Error("商品明細包含不存在的商品");
  }
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
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "FinanceTransactionItem"
          ("id", "transactionId", "productId", "sku", "productName", "size", "quantity", "unitAmount", "lineAmount")
        VALUES
          (${randomUUID()}, ${id}, ${item.productId ?? null}, ${item.sku ?? null}, ${item.productName}, ${item.size ?? null}, ${item.quantity}, ${item.unitAmount ?? null}, ${item.lineAmount})
      `);
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
      },
      ipAddress: actor.ipAddress ?? null,
    }});
    return { id };
  });
}

export async function updateFinanceTransaction(id: string, input: z.infer<typeof financeUpdateSchema>, actor: Actor) {
  if (actor.role === "VIEWER") throw new Error("目前角色沒有修改收支權限");
  const current = await prisma.$queryRaw<Array<{ id: string; direction: "INCOME" | "EXPENSE" }>>(Prisma.sql`SELECT "id", "direction" FROM "FinanceTransaction" WHERE "id" = ${id} LIMIT 1`);
  if (!current[0]) throw new Error("找不到收支紀錄");
  if (Object.prototype.hasOwnProperty.call(input, "categoryId")) await validateCategory(input.categoryId, current[0].direction);
  await prisma.$executeRaw(Prisma.sql`
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
  await prisma.auditLog.create({ data: { userId: actor.userId, action: "FINANCE_TRANSACTION_UPDATED", entityType: "FinanceTransaction", entityId: id, metadata: input, ipAddress: actor.ipAddress ?? null } });
  return { id };
}

export async function getFinanceDashboard(month: string) {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error("月份格式錯誤");
  const year = Number(match[1]);
  const mon = Number(match[2]);
  const start = new Date(`${month}-01T00:00:00+08:00`);
  const nextMonth = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, "0")}-01`;
  const end = new Date(`${nextMonth}T00:00:00+08:00`);
  const totals = await prisma.$queryRaw<Array<{ income: Prisma.Decimal; expense: Prisma.Decimal; receivable: Prisma.Decimal }>>(Prisma.sql`
    SELECT
      COALESCE(SUM(CASE WHEN "direction" = 'INCOME' THEN "amount" ELSE 0 END), 0) AS "income",
      COALESCE(SUM(CASE WHEN "direction" = 'EXPENSE' THEN "amount" ELSE 0 END), 0) AS "expense",
      COALESCE(SUM(CASE WHEN "direction" = 'INCOME' AND "paymentStatus" IN ('PENDING','PARTIAL') THEN "amount" ELSE 0 END), 0) AS "receivable"
    FROM "FinanceTransaction" WHERE "occurredAt" >= ${start} AND "occurredAt" < ${end} AND "paymentStatus" <> 'VOID'
  `);
  const topProducts = await prisma.$queryRaw<Array<{ productId: string | null; productName: string; revenue: Prisma.Decimal; quantity: bigint }>>(Prisma.sql`
    SELECT i."productId", i."productName", COALESCE(SUM(i."lineAmount"),0) AS "revenue", COALESCE(SUM(i."quantity"),0) AS "quantity"
    FROM "FinanceTransactionItem" i JOIN "FinanceTransaction" t ON t."id" = i."transactionId"
    WHERE t."occurredAt" >= ${start} AND t."occurredAt" < ${end} AND t."direction" = 'INCOME' AND t."paymentStatus" <> 'VOID'
    GROUP BY i."productId", i."productName" ORDER BY "revenue" DESC LIMIT 8
  `);
  const topCategories = await prisma.$queryRaw<Array<{ name: string; amount: Prisma.Decimal }>>(Prisma.sql`
    SELECT COALESCE(parent."name", c."name", '未分類') AS "name", COALESCE(SUM(t."amount"),0) AS "amount"
    FROM "FinanceTransaction" t
    LEFT JOIN "FinanceCategory" c ON c."id" = t."categoryId"
    LEFT JOIN "FinanceCategory" parent ON parent."id" = c."parentId"
    WHERE t."occurredAt" >= ${start} AND t."occurredAt" < ${end} AND t."direction" = 'EXPENSE' AND t."paymentStatus" <> 'VOID'
    GROUP BY COALESCE(parent."name", c."name", '未分類') ORDER BY "amount" DESC LIMIT 8
  `);
  const topChannels = await prisma.$queryRaw<Array<{ name: string; amount: Prisma.Decimal }>>(Prisma.sql`
    SELECT COALESCE(NULLIF("salesChannel", ''), '未指定') AS "name", COALESCE(SUM("amount"),0) AS "amount"
    FROM "FinanceTransaction"
    WHERE "occurredAt" >= ${start} AND "occurredAt" < ${end} AND "direction" = 'INCOME' AND "paymentStatus" <> 'VOID'
    GROUP BY COALESCE(NULLIF("salesChannel", ''), '未指定') ORDER BY "amount" DESC LIMIT 8
  `);
  const row = totals[0] ?? { income: new Prisma.Decimal(0), expense: new Prisma.Decimal(0), receivable: new Prisma.Decimal(0) };
  return {
    income: Number(row.income),
    expense: Number(row.expense),
    cashFlow: Number(row.income) - Number(row.expense),
    receivable: Number(row.receivable),
    topProducts: topProducts.map((item) => ({ ...item, revenue: Number(item.revenue), quantity: Number(item.quantity) })),
    topCategories: topCategories.map((item) => ({ ...item, amount: Number(item.amount) })),
    topChannels: topChannels.map((item) => ({ ...item, amount: Number(item.amount) })),
  };
}
