import { randomUUID } from "node:crypto";
import { BillingSourceType, Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const billingPreviewSchema = z.object({
  channelId: z.string().min(1),
  periodStart: z.string().regex(datePattern),
  periodEnd: z.string().regex(datePattern),
}).refine((value) => value.periodStart <= value.periodEnd, { message: "請款期間起日不可晚於迄日" });

const billingItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(1_000_000),
});

export const billingCreateSchema = z.object({
  channelId: z.string().min(1),
  periodStart: z.string().regex(datePattern),
  periodEnd: z.string().regex(datePattern),
  issuedAt: z.string().regex(datePattern),
  settlementRate: z.coerce.number().gt(0).max(1),
  taxRate: z.coerce.number().min(0).max(1),
  shippingFee: z.coerce.number().min(0).max(1_000_000).default(0),
  note: z.string().trim().max(1000).optional().nullable(),
  items: z.array(billingItemSchema).min(1).max(200),
  sourceMovementIds: z.array(z.string().min(1)).max(5000).default([]),
}).refine((value) => value.periodStart <= value.periodEnd, { message: "請款期間起日不可晚於迄日" });

export const markBillingPaidSchema = z.object({
  paidAt: z.string().regex(datePattern),
  paidAmount: z.coerce.number().min(0).max(100_000_000),
  paymentMethod: z.string().trim().max(80).optional().nullable(),
  paymentReference: z.string().trim().max(120).optional().nullable(),
});

export type BillingPreviewInput = z.infer<typeof billingPreviewSchema>;
export type BillingCreateInput = z.infer<typeof billingCreateSchema>;

type Actor = { userId: string; role: UserRole; ipAddress?: string | null };
type Db = Prisma.TransactionClient | typeof prisma;

type SettlementSource = {
  id: string;
  productId: string;
  quantity: number;
  occurredAt: Date;
  unitPrice: Prisma.Decimal | null;
  referenceNo: string | null;
  product: {
    id: string;
    sku: string;
    name: string;
    size: string | null;
    listPrice: Prisma.Decimal | null;
    unitCost: Prisma.Decimal | null;
  };
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

function sourceForChannel(type: string): { sourceType: BillingSourceType; movementType: "CONSIGN_SOLD" | "BUYOUT"; financeCategoryCode: "sales" | "wholesale" } {
  if (type === "CONSIGNMENT") return { sourceType: "CONSIGNMENT", movementType: "CONSIGN_SOLD", financeCategoryCode: "sales" };
  if (type === "BUYOUT") return { sourceType: "BUYOUT", movementType: "BUYOUT", financeCategoryCode: "wholesale" };
  throw new Error("請款目前僅支援寄賣與買斷通路");
}

async function findUnsettledMovements(db: Db, input: BillingPreviewInput, movementType: "CONSIGN_SOLD" | "BUYOUT") {
  return db.stockMovement.findMany({
    where: {
      channelId: input.channelId,
      type: movementType,
      quantity: { gt: 0 },
      occurredAt: { gte: startOfTaipeiDate(input.periodStart), lte: endOfTaipeiDate(input.periodEnd) },
      reversedAt: null,
      reversalOfId: null,
      billingSource: { is: null },
    },
    include: { product: true },
    orderBy: [{ product: { sku: "asc" } }, { occurredAt: "asc" }],
  });
}

function groupMovementQuantities(movements: Array<{ productId: string; quantity: number }>) {
  const grouped = new Map<string, number>();
  for (const movement of movements) grouped.set(movement.productId, (grouped.get(movement.productId) ?? 0) + movement.quantity);
  return grouped;
}

function groupRequestedQuantities(items: BillingCreateInput["items"]) {
  const grouped = new Map<string, number>();
  for (const item of items) grouped.set(item.productId, (grouped.get(item.productId) ?? 0) + item.quantity);
  return grouped;
}

function quantitiesMatch(left: Map<string, number>, right: Map<string, number>) {
  if (left.size !== right.size) return false;
  for (const [productId, quantity] of left) if (right.get(productId) !== quantity) return false;
  return true;
}

async function buildPreview(db: Db, input: BillingPreviewInput) {
  const channel = await db.channel.findUnique({ where: { id: input.channelId } });
  if (!channel || !channel.active) throw new Error("找不到可用的客戶通路");
  const source = sourceForChannel(channel.type);
  const movements = await findUnsettledMovements(db, input, source.movementType);

  const grouped = new Map<string, {
    productId: string;
    sku: string;
    productName: string;
    size: string | null;
    listPrice: number | null;
    quantity: number;
  }>();

  for (const movement of movements) {
    const existing = grouped.get(movement.productId);
    if (existing) {
      existing.quantity += movement.quantity;
    } else {
      grouped.set(movement.productId, {
        productId: movement.productId,
        sku: movement.product.sku,
        productName: movement.product.name,
        size: movement.product.size,
        listPrice: movement.product.listPrice === null ? null : Number(movement.product.listPrice),
        quantity: movement.quantity,
      });
    }
  }

  return {
    sourceType: source.sourceType,
    sourceMovementCount: movements.length,
    sourceMovementIds: movements.map((movement) => movement.id),
    items: [...grouped.values()].sort((a, b) => a.sku.localeCompare(b.sku, "zh-Hant", { numeric: true })),
  };
}

export async function previewBillingStatement(input: BillingPreviewInput) {
  return buildPreview(prisma, input);
}

async function nextStatementNo(tx: Prisma.TransactionClient, issuedAt: string) {
  const month = issuedAt.slice(0, 7).replace("-", "");
  const prefix = `BL-${month}-`;
  const count = await tx.billingStatement.count({ where: { statementNo: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(3, "0")}`;
}

function retryable(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2034" || error.code === "P2002";
}

function periodLabel(start: string, end: string) {
  if (start.slice(0, 7) === end.slice(0, 7)) return start.slice(0, 7).replace("-", "/");
  return `${start}～${end}`;
}

export async function createBillingStatement(input: BillingCreateInput, actor: Actor) {
  if (actor.role === "VIEWER") throw new Error("目前角色沒有建立請款單權限");
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const channel = await tx.channel.findUnique({ where: { id: input.channelId } });
        if (!channel || !channel.active) throw new Error("找不到可用的客戶通路");
        const source = sourceForChannel(channel.type);

        const quantities = groupRequestedQuantities(input.items);
        const productIds = [...quantities.keys()];
        const products = await tx.product.findMany({ where: { id: { in: productIds }, active: true } });
        if (products.length !== productIds.length) throw new Error("請款品項包含不存在或已停用的商品");

        const eligibleMovements = await findUnsettledMovements(tx, input, source.movementType) as SettlementSource[];
        const requestedIds = [...new Set(input.sourceMovementIds)];
        let settlementSources: SettlementSource[] = [];

        if (requestedIds.length > 0) {
          const requested = new Set(requestedIds);
          settlementSources = eligibleMovements.filter((movement) => requested.has(movement.id));
          if (settlementSources.length !== requestedIds.length) throw new Error("部分銷貨已被其他結算使用或已不符合條件，請重新帶入後再建立");
          if (!quantitiesMatch(groupMovementQuantities(settlementSources), quantities)) {
            throw new Error("結算品項與來源銷貨數量不一致，請重新帶入後再建立");
          }
        } else if (eligibleMovements.length > 0 && quantitiesMatch(groupMovementQuantities(eligibleMovements), quantities)) {
          settlementSources = eligibleMovements;
        }

        const productById = new Map(products.map((product) => [product.id, product]));
        const items = products
          .map((product) => {
            if (product.listPrice === null) throw new Error(`商品 ${product.sku} 尚未設定建議售價`);
            const listPrice = Number(product.listPrice);
            const settlementPrice = roundMoney(listPrice * input.settlementRate);
            const quantity = quantities.get(product.id) ?? 0;
            return {
              productId: product.id,
              sku: product.sku,
              productName: product.name,
              size: product.size,
              listPrice,
              settlementPrice,
              quantity,
              subtotal: roundMoney(settlementPrice * quantity),
            };
          })
          .sort((a, b) => a.sku.localeCompare(b.sku, "zh-Hant", { numeric: true }));

        const subtotal = roundMoney(items.reduce((sum, item) => sum + item.subtotal, 0));
        const taxAmount = roundMoney(subtotal * input.taxRate);
        const shippingFee = roundMoney(input.shippingFee);
        const totalAmount = roundMoney(subtotal + taxAmount + shippingFee);
        if (totalAmount <= 0) throw new Error("結算金額必須大於 0");

        const statementNo = await nextStatementNo(tx, input.issuedAt);
        const issuedAt = startOfTaipeiDate(input.issuedAt);
        const dueDate = new Date(issuedAt);
        dueDate.setDate(dueDate.getDate() + (channel.paymentTermsDays ?? 0));

        const statement = await tx.billingStatement.create({
          data: {
            statementNo,
            channelId: input.channelId,
            sourceType: source.sourceType,
            periodStart: startOfTaipeiDate(input.periodStart),
            periodEnd: endOfTaipeiDate(input.periodEnd),
            issuedAt,
            dueDate,
            companyName: channel.companyName ?? channel.name,
            taxId: channel.taxId,
            contactName: channel.contactName,
            contactEmail: channel.contactEmail,
            contactPhone: channel.contactPhone,
            billingAddress: channel.billingAddress,
            settlementRate: input.settlementRate,
            taxRate: input.taxRate,
            subtotal,
            taxAmount,
            shippingFee,
            totalAmount,
            status: "ISSUED",
            note: input.note || null,
            createdById: actor.userId,
            items: { create: items },
          },
          include: { items: true, channel: true },
        });

        if (settlementSources.length > 0) {
          await tx.billingStatementSource.createMany({
            data: settlementSources.map((movement) => ({ statementId: statement.id, movementId: movement.id })),
          });
        }

        const category = await tx.financeCategory.findUnique({ where: { code: source.financeCategoryCode }, select: { id: true } });
        if (!category) throw new Error(`找不到財務收入分類 ${source.financeCategoryCode}`);
        const financeId = randomUUID();
        await tx.financeTransaction.create({
          data: {
            id: financeId,
            occurredAt: issuedAt,
            direction: "INCOME",
            amount: totalAmount,
            categoryId: category.id,
            counterparty: channel.companyName ?? channel.name,
            relatedParty: channel.name,
            salesChannel: channel.name,
            summary: `${channel.name} · ${periodLabel(input.periodStart, input.periodEnd)} 結算`,
            channelId: channel.id,
            source: "BILLING",
            sourceRef: `BILLING:${statement.id}`,
            paymentStatus: "PENDING",
            reconciliationStatus: "UNMATCHED",
            invoiceStatus: "NOT_REQUIRED",
            note: [`請款單 ${statementNo}`, `期間 ${input.periodStart}～${input.periodEnd}`, settlementSources.length ? `來源銷貨 ${settlementSources.length} 筆` : "手動請款"].join("；"),
            createdById: actor.userId,
            items: {
              create: items.map((item) => ({
                id: randomUUID(),
                productId: item.productId,
                sku: item.sku,
                productName: item.productName,
                size: item.size,
                quantity: item.quantity,
                unitAmount: item.settlementPrice,
                lineAmount: item.subtotal,
                unitCostSnapshot: productById.get(item.productId)?.unitCost ?? null,
              })),
            },
          },
        });

        await tx.auditLog.create({
          data: {
            userId: actor.userId,
            action: "BILLING_STATEMENT_CREATED",
            entityType: "BillingStatement",
            entityId: statement.id,
            metadata: {
              statementNo,
              channelId: input.channelId,
              totalAmount,
              entryMode: settlementSources.length ? "SETTLEMENT" : "MANUAL",
              itemCount: items.length,
              sourceMovementCount: settlementSources.length,
              financeTransactionId: financeId,
            },
            ipAddress: actor.ipAddress ?? null,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: actor.userId,
            action: "BILLING_FINANCE_CREATED",
            entityType: "FinanceTransaction",
            entityId: financeId,
            metadata: { statementId: statement.id, statementNo, sourceMovementCount: settlementSources.length, amount: totalAmount },
            ipAddress: actor.ipAddress ?? null,
          },
        });
        return statement;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryable(error) || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (2 ** (attempt - 1))));
    }
  }
  throw new Error("請款單建立失敗");
}

export async function markBillingStatementPaid(
  id: string,
  input: z.infer<typeof markBillingPaidSchema>,
  actor: Actor,
) {
  if (actor.role === "VIEWER") throw new Error("目前角色沒有收款登記權限");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.billingStatement.findUnique({ where: { id } });
    if (!existing) throw new Error("找不到請款單");
    if (existing.status === "VOID") throw new Error("已作廢請款單不可登記收款");
    const updated = await tx.billingStatement.update({
      where: { id },
      data: {
        status: "PAID",
        paidAt: startOfTaipeiDate(input.paidAt),
        paidAmount: input.paidAmount,
        paymentMethod: input.paymentMethod || null,
        paymentReference: input.paymentReference || null,
      },
    });
    await tx.financeTransaction.updateMany({
      where: { sourceRef: `BILLING:${id}`, paymentStatus: { not: "VOID" } },
      data: { paymentStatus: "PAID" },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: "BILLING_STATEMENT_PAID",
        entityType: "BillingStatement",
        entityId: id,
        metadata: { statementNo: existing.statementNo, paidAmount: input.paidAmount, financeSynced: true },
        ipAddress: actor.ipAddress ?? null,
      },
    });
    return updated;
  });
}

export async function voidBillingStatement(id: string, actor: Actor) {
  if (actor.role === "VIEWER") throw new Error("目前角色沒有作廢請款單權限");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.billingStatement.findUnique({
      where: { id },
      include: { sources: { select: { movementId: true } } },
    });
    if (!existing) throw new Error("找不到請款單");
    if (existing.status === "PAID") throw new Error("已收款請款單不可直接作廢");
    if (existing.status === "VOID") throw new Error("請款單已經作廢");
    if (existing.status !== "ISSUED") throw new Error("只有待收款請款單可以作廢");

    const movementIds = existing.sources.map((source) => source.movementId);
    if (movementIds.length > 0) await tx.billingStatementSource.deleteMany({ where: { statementId: id } });
    const updated = await tx.billingStatement.update({ where: { id }, data: { status: "VOID" } });
    await tx.financeTransaction.updateMany({ where: { sourceRef: `BILLING:${id}` }, data: { paymentStatus: "VOID" } });
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: "BILLING_STATEMENT_VOIDED",
        entityType: "BillingStatement",
        entityId: id,
        metadata: { statementNo: existing.statementNo, releasedSourceCount: movementIds.length, movementIds, financeVoided: true },
        ipAddress: actor.ipAddress ?? null,
      },
    });
    return updated;
  });
}
