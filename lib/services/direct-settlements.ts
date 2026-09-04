import { randomUUID } from "node:crypto";
import { Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const directSettlementPreviewSchema = z.object({
  channelId: z.string().min(1),
  periodStart: z.string().regex(datePattern),
  periodEnd: z.string().regex(datePattern),
}).refine((value) => value.periodStart <= value.periodEnd, { message: "結算期間起日不可晚於迄日" });

export const directSettlementCreateSchema = z.object({
  channelId: z.string().min(1),
  periodStart: z.string().regex(datePattern),
  periodEnd: z.string().regex(datePattern),
  settledAt: z.string().regex(datePattern),
  sourceMovementIds: z.array(z.string().min(1)).min(1).max(10000),
  platformFee: z.coerce.number().min(0).max(100_000_000).default(0),
  paymentFee: z.coerce.number().min(0).max(100_000_000).default(0),
  otherFee: z.coerce.number().min(0).max(100_000_000).default(0),
  actualPayout: z.union([z.coerce.number().min(0).max(100_000_000), z.null()]).optional(),
  payoutReference: z.string().trim().max(160).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
}).refine((value) => value.periodStart <= value.periodEnd, { message: "結算期間起日不可晚於迄日" });

export type DirectSettlementPreviewInput = z.infer<typeof directSettlementPreviewSchema>;
export type DirectSettlementCreateInput = z.infer<typeof directSettlementCreateSchema>;

type Actor = { userId: string; role: UserRole; ipAddress?: string | null };
type Db = Prisma.TransactionClient | typeof prisma;

type SourceMovement = {
  id: string;
  occurredAt: Date;
  type: "SHIP" | "SALES_RETURN";
  quantity: number;
  unitPrice: Prisma.Decimal | null;
  referenceNo: string | null;
  shippingFee: Prisma.Decimal | null;
  shippingPayer: string | null;
  shippingGroupKey: string | null;
  productId: string;
  product: {
    id: string;
    sku: string;
    name: string;
    size: string | null;
    unitCost: Prisma.Decimal | null;
  };
};

type ProductAggregate = {
  productId: string;
  sku: string;
  productName: string;
  size: string | null;
  quantity: number;
  amount: number;
  unitCost: Prisma.Decimal | null;
};

function startOfTaipeiDate(value: string) {
  return new Date(`${value}T00:00:00+08:00`);
}

function endOfTaipeiDate(value: string) {
  return new Date(`${value}T23:59:59.999+08:00`);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function periodLabel(start: string, end: string) {
  if (start.slice(0, 7) === end.slice(0, 7)) return start.slice(0, 7).replace("-", "/");
  return `${start}～${end}`;
}

async function findEligibleMovements(db: Db, input: DirectSettlementPreviewInput) {
  const rows = await db.stockMovement.findMany({
    where: {
      channelId: input.channelId,
      type: { in: ["SHIP", "SALES_RETURN"] },
      quantity: { gt: 0 },
      occurredAt: { gte: startOfTaipeiDate(input.periodStart), lte: endOfTaipeiDate(input.periodEnd) },
      reversedAt: null,
      reversalOfId: null,
    },
    include: { product: true },
    orderBy: [{ occurredAt: "asc" }, { product: { sku: "asc" } }],
  }) as SourceMovement[];
  if (rows.length === 0) return rows;
  const used = await db.directSettlementSource.findMany({
    where: { movementId: { in: rows.map((row) => row.id) } },
    select: { movementId: true },
  });
  const usedIds = new Set(used.map((row) => row.movementId));
  return rows.filter((row) => !usedIds.has(row.id));
}

function aggregateProducts(rows: SourceMovement[], type: "SHIP" | "SALES_RETURN") {
  const grouped = new Map<string, ProductAggregate>();
  for (const row of rows) {
    if (row.type !== type) continue;
    if (row.unitPrice === null) throw new Error(`銷售異動 ${row.id} 缺少成交單價，請先修正庫存異動`);
    const amount = roundMoney(Number(row.unitPrice) * row.quantity);
    const current = grouped.get(row.productId);
    if (current) {
      current.quantity += row.quantity;
      current.amount = roundMoney(current.amount + amount);
    } else {
      grouped.set(row.productId, {
        productId: row.product.id,
        sku: row.product.sku,
        productName: row.product.name,
        size: row.product.size,
        quantity: row.quantity,
        amount,
        unitCost: row.product.unitCost,
      });
    }
  }
  return [...grouped.values()].sort((a, b) => a.sku.localeCompare(b.sku, "zh-Hant", { numeric: true }));
}

function customerShippingIncome(rows: SourceMovement[]) {
  const groups = new Map<string, number>();
  for (const row of rows) {
    if (row.type !== "SHIP" || row.shippingPayer !== "CUSTOMER" || row.shippingFee === null || Number(row.shippingFee) <= 0) continue;
    const key = row.shippingGroupKey || row.id;
    const fee = Number(row.shippingFee);
    if (!groups.has(key)) groups.set(key, fee);
    else groups.set(key, Math.max(groups.get(key) ?? 0, fee));
  }
  return { amount: roundMoney([...groups.values()].reduce((sum, fee) => sum + fee, 0)), groupCount: groups.size };
}

function buildAmounts(rows: SourceMovement[]) {
  const sales = aggregateProducts(rows, "SHIP");
  const returns = aggregateProducts(rows, "SALES_RETURN");
  const grossSales = roundMoney(sales.reduce((sum, item) => sum + item.amount, 0));
  const refundAmount = roundMoney(returns.reduce((sum, item) => sum + item.amount, 0));
  const shipping = customerShippingIncome(rows);
  return { sales, returns, grossSales, refundAmount, shippingIncome: shipping.amount, shippingGroupCount: shipping.groupCount };
}

async function buildPreview(db: Db, input: DirectSettlementPreviewInput) {
  const channel = await db.channel.findUnique({ where: { id: input.channelId } });
  if (!channel || !channel.active || channel.type !== "DIRECT") throw new Error("找不到可用的直營通路");
  const movements = await findEligibleMovements(db, input);
  const amounts = buildAmounts(movements);
  return {
    channel: {
      id: channel.id,
      name: channel.name,
      settlementCycle: channel.settlementCycle,
      billingTrigger: channel.billingTrigger,
    },
    sourceMovementCount: movements.length,
    sourceMovementIds: movements.map((movement) => movement.id),
    salesMovementCount: movements.filter((movement) => movement.type === "SHIP").length,
    returnMovementCount: movements.filter((movement) => movement.type === "SALES_RETURN").length,
    ...amounts,
  };
}

export async function previewDirectSettlement(input: DirectSettlementPreviewInput) {
  return buildPreview(prisma, input);
}

async function nextSettlementNo(tx: Prisma.TransactionClient, settledAt: string) {
  const month = settledAt.slice(0, 7).replace("-", "");
  const prefix = `DS-${month}-`;
  const count = await tx.directSettlement.count({ where: { settlementNo: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(3, "0")}`;
}

function financeItems(items: ProductAggregate[]) {
  return items.map((item) => ({
    id: randomUUID(),
    productId: item.productId,
    sku: item.sku,
    productName: item.productName,
    size: item.size,
    quantity: item.quantity,
    unitAmount: item.quantity > 0 ? roundMoney(item.amount / item.quantity) : null,
    lineAmount: item.amount,
    unitCostSnapshot: item.unitCost,
  }));
}

async function categoryId(tx: Prisma.TransactionClient, code: string) {
  const category = await tx.financeCategory.findUnique({ where: { code }, select: { id: true } });
  if (!category) throw new Error(`找不到財務分類 ${code}`);
  return category.id;
}

export async function createDirectSettlement(input: DirectSettlementCreateInput, actor: Actor) {
  if (actor.role === "VIEWER") throw new Error("目前角色沒有建立直營結算權限");
  return prisma.$transaction(async (tx) => {
    const channel = await tx.channel.findUnique({ where: { id: input.channelId } });
    if (!channel || !channel.active || channel.type !== "DIRECT") throw new Error("找不到可用的直營通路");

    const eligible = await findEligibleMovements(tx, input);
    const requestedIds = [...new Set(input.sourceMovementIds)];
    const requested = new Set(requestedIds);
    const sources = eligible.filter((movement) => requested.has(movement.id));
    if (sources.length !== requestedIds.length) throw new Error("部分銷售已被其他結算使用或已不符合條件，請重新整理後再建立");

    const amounts = buildAmounts(sources);
    if (amounts.grossSales <= 0 && amounts.refundAmount <= 0) throw new Error("這個期間沒有可結算的直營銷售");
    const platformFee = roundMoney(input.platformFee);
    const paymentFee = roundMoney(input.paymentFee);
    const otherFee = roundMoney(input.otherFee);
    const expectedPayout = roundMoney(amounts.grossSales + amounts.shippingIncome - amounts.refundAmount - platformFee - paymentFee - otherFee);
    const actualPayout = input.actualPayout == null ? null : roundMoney(input.actualPayout);
    const discrepancy = actualPayout === null ? null : roundMoney(actualPayout - expectedPayout);
    const reconciled = actualPayout !== null && Math.abs(discrepancy ?? 0) <= 0.01;
    const settlementNo = await nextSettlementNo(tx, input.settledAt);
    const settledAt = startOfTaipeiDate(input.settledAt);

    const settlement = await tx.directSettlement.create({
      data: {
        settlementNo,
        channelId: channel.id,
        periodStart: startOfTaipeiDate(input.periodStart),
        periodEnd: endOfTaipeiDate(input.periodEnd),
        settledAt,
        grossSales: amounts.grossSales,
        shippingIncome: amounts.shippingIncome,
        refundAmount: amounts.refundAmount,
        platformFee,
        paymentFee,
        otherFee,
        expectedPayout,
        actualPayout,
        discrepancy,
        payoutReference: input.payoutReference || null,
        status: reconciled ? "RECONCILED" : "OPEN",
        note: input.note || null,
        createdById: actor.userId,
      },
    });

    await tx.directSettlementSource.createMany({
      data: sources.map((movement) => ({ settlementId: settlement.id, movementId: movement.id })),
    });

    const [salesCategoryId, platformFeeCategoryId, paymentFeeCategoryId, otherCategoryId] = await Promise.all([
      categoryId(tx, "sales"),
      categoryId(tx, "platform_fee"),
      categoryId(tx, "payment_fee"),
      categoryId(tx, "other"),
    ]);
    const paymentStatus = actualPayout === null ? "PENDING" as const : "PAID" as const;
    const reconciliationStatus = reconciled ? "RECONCILED" as const : "UNMATCHED" as const;
    const financeIds: string[] = [];

    if (amounts.grossSales + amounts.shippingIncome > 0) {
      const id = randomUUID();
      financeIds.push(id);
      await tx.financeTransaction.create({
        data: {
          id,
          occurredAt: settledAt,
          direction: "INCOME",
          amount: roundMoney(amounts.grossSales + amounts.shippingIncome),
          categoryId: salesCategoryId,
          counterparty: channel.name,
          relatedParty: channel.name,
          salesChannel: channel.name,
          summary: `${channel.name} · ${periodLabel(input.periodStart, input.periodEnd)} 直營銷售結算`,
          channelId: channel.id,
          source: "OTHER",
          sourceRef: `DIRECT_SETTLEMENT:${settlement.id}:SALES`,
          paymentStatus,
          reconciliationStatus,
          invoiceStatus: "NOT_REQUIRED",
          note: [`結算 ${settlementNo}`, `銷售 ${amounts.grossSales}`, amounts.shippingIncome > 0 ? `客戶運費 ${amounts.shippingIncome}` : null].filter(Boolean).join("；"),
          createdById: actor.userId,
          items: { create: financeItems(amounts.sales) },
        },
      });
    }

    if (amounts.refundAmount > 0) {
      const id = randomUUID();
      financeIds.push(id);
      await tx.financeTransaction.create({
        data: {
          id,
          occurredAt: settledAt,
          direction: "INCOME",
          amount: amounts.refundAmount,
          categoryId: salesCategoryId,
          counterparty: channel.name,
          relatedParty: channel.name,
          salesChannel: channel.name,
          summary: `${channel.name} · ${periodLabel(input.periodStart, input.periodEnd)} 退款彙總`,
          channelId: channel.id,
          source: "OTHER",
          sourceRef: `RETURN:DIRECT_SETTLEMENT:${settlement.id}`,
          paymentStatus: "REFUNDED",
          reconciliationStatus,
          invoiceStatus: "NOT_REQUIRED",
          note: `直營結算 ${settlementNo}；銷貨退回 ${amounts.refundAmount}`,
          createdById: actor.userId,
          items: { create: financeItems(amounts.returns) },
        },
      });
    }

    const expenseRows = [
      { code: "PLATFORM_FEE", amount: platformFee, categoryId: platformFeeCategoryId, label: "平台手續費" },
      { code: "PAYMENT_FEE", amount: paymentFee, categoryId: paymentFeeCategoryId, label: "金流手續費" },
      { code: "OTHER_FEE", amount: otherFee, categoryId: otherCategoryId, label: "其他平台扣款" },
    ];
    for (const fee of expenseRows) {
      if (fee.amount <= 0) continue;
      const id = randomUUID();
      financeIds.push(id);
      await tx.financeTransaction.create({
        data: {
          id,
          occurredAt: settledAt,
          direction: "EXPENSE",
          amount: fee.amount,
          categoryId: fee.categoryId,
          counterparty: channel.name,
          relatedParty: channel.name,
          salesChannel: channel.name,
          summary: `${channel.name} · ${fee.label}`,
          channelId: channel.id,
          source: "OTHER",
          sourceRef: `DIRECT_SETTLEMENT:${settlement.id}:${fee.code}`,
          paymentStatus,
          reconciliationStatus,
          invoiceStatus: "NOT_REQUIRED",
          note: `直營結算 ${settlementNo}`,
          createdById: actor.userId,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: "DIRECT_SETTLEMENT_CREATED",
        entityType: "DirectSettlement",
        entityId: settlement.id,
        metadata: {
          settlementNo,
          channelId: channel.id,
          sourceMovementCount: sources.length,
          grossSales: amounts.grossSales,
          shippingIncome: amounts.shippingIncome,
          refundAmount: amounts.refundAmount,
          platformFee,
          paymentFee,
          otherFee,
          expectedPayout,
          actualPayout,
          discrepancy,
          financeTransactionIds: financeIds,
        },
        ipAddress: actor.ipAddress ?? null,
      },
    });
    return settlement;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function voidDirectSettlement(id: string, actor: Actor) {
  if (actor.role === "VIEWER") throw new Error("目前角色沒有作廢直營結算權限");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.directSettlement.findUnique({ where: { id } });
    if (!existing) throw new Error("找不到直營結算");
    if (existing.status === "VOID") throw new Error("這筆結算已經作廢");
    if (existing.status === "RECONCILED") throw new Error("已對帳完成的撥款不可直接作廢，請先建立調整紀錄");

    const released = await tx.directSettlementSource.deleteMany({ where: { settlementId: id } });
    const updated = await tx.directSettlement.update({ where: { id }, data: { status: "VOID" } });
    await tx.financeTransaction.updateMany({
      where: {
        OR: [
          { sourceRef: { startsWith: `DIRECT_SETTLEMENT:${id}:` } },
          { sourceRef: `RETURN:DIRECT_SETTLEMENT:${id}` },
        ],
      },
      data: { paymentStatus: "VOID" },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: "DIRECT_SETTLEMENT_VOIDED",
        entityType: "DirectSettlement",
        entityId: id,
        metadata: { settlementNo: existing.settlementNo, releasedSourceCount: released.count, financeVoided: true },
        ipAddress: actor.ipAddress ?? null,
      },
    });
    return updated;
  });
}
