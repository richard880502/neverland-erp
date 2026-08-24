import { BillingSourceType, Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const billingPreviewSchema = z.object({
  channelId: z.string().min(1),
  periodStart: z.string().regex(datePattern),
  periodEnd: z.string().regex(datePattern),
  settlementRate: z.coerce.number().min(0).max(1),
  taxRate: z.coerce.number().min(0).max(1),
  shippingFee: z.coerce.number().min(0).max(1_000_000).default(0),
}).refine((value) => value.periodStart <= value.periodEnd, { message: "結算起日不可晚於迄日" });

export const billingCreateSchema = billingPreviewSchema.and(z.object({
  issuedAt: z.string().regex(datePattern),
  note: z.string().trim().max(1000).optional().nullable(),
}));

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

function startOfTaipeiDate(value: string) {
  return new Date(`${value}T00:00:00+08:00`);
}

function endOfTaipeiDate(value: string) {
  return new Date(`${value}T23:59:59.999+08:00`);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sourceForChannel(type: string): { sourceType: BillingSourceType; movementType: "CONSIGN_SOLD" | "BUYOUT" } {
  if (type === "CONSIGNMENT") return { sourceType: "CONSIGNMENT", movementType: "CONSIGN_SOLD" };
  if (type === "BUYOUT") return { sourceType: "BUYOUT", movementType: "BUYOUT" };
  throw new Error("請款目前僅支援寄賣與買斷通路");
}

async function buildPreview(db: Db, input: BillingPreviewInput) {
  const channel = await db.channel.findUnique({ where: { id: input.channelId } });
  if (!channel || !channel.active) throw new Error("找不到可用的客戶通路");
  const source = sourceForChannel(channel.type);
  const movements = await db.stockMovement.findMany({
    where: {
      channelId: channel.id,
      type: source.movementType,
      quantity: { gt: 0 },
      occurredAt: { gte: startOfTaipeiDate(input.periodStart), lte: endOfTaipeiDate(input.periodEnd) },
      reversedAt: null,
      reversalOfId: null,
    },
    include: { product: true, billingSource: { select: { statementId: true } } },
    orderBy: [{ product: { sku: "asc" } }, { occurredAt: "asc" }],
  });

  const available = movements.filter((movement) => !movement.billingSource);
  const grouped = new Map<string, {
    productId: string;
    sku: string;
    productName: string;
    size: string | null;
    listPrice: number;
    quantity: number;
    movementIds: string[];
  }>();

  for (const movement of available) {
    const rawPrice = movement.product.listPrice ?? movement.unitPrice;
    if (rawPrice === null) throw new Error(`商品 ${movement.product.sku} 尚未設定建議售價`);
    const listPrice = Number(rawPrice);
    const existing = grouped.get(movement.productId);
    if (existing) {
      existing.quantity += movement.quantity;
      existing.movementIds.push(movement.id);
    } else {
      grouped.set(movement.productId, {
        productId: movement.productId,
        sku: movement.product.sku,
        productName: movement.product.name,
        size: movement.product.size,
        listPrice,
        quantity: movement.quantity,
        movementIds: [movement.id],
      });
    }
  }

  const items = [...grouped.values()].sort((a, b) => a.sku.localeCompare(b.sku)).map((item) => {
    const settlementPrice = roundMoney(item.listPrice * input.settlementRate);
    return { ...item, settlementPrice, subtotal: roundMoney(settlementPrice * item.quantity) };
  });
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.subtotal, 0));
  const taxAmount = roundMoney(subtotal * input.taxRate);
  const totalAmount = roundMoney(subtotal + taxAmount + input.shippingFee);

  return {
    channel: {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      companyName: channel.companyName ?? channel.name,
      taxId: channel.taxId,
      contactName: channel.contactName,
      contactEmail: channel.contactEmail,
      contactPhone: channel.contactPhone,
      billingAddress: channel.billingAddress,
      paymentTermsDays: channel.paymentTermsDays ?? 0,
    },
    sourceType: source.sourceType,
    items,
    sourceMovementCount: available.length,
    alreadyBilledCount: movements.length - available.length,
    subtotal,
    taxAmount,
    shippingFee: roundMoney(input.shippingFee),
    totalAmount,
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

export async function createBillingStatement(input: BillingCreateInput, actor: Actor) {
  if (actor.role === "VIEWER") throw new Error("目前角色沒有建立請款單權限");
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const preview = await buildPreview(tx, input);
        if (preview.sourceMovementCount === 0 || preview.items.length === 0) {
          throw new Error(preview.alreadyBilledCount > 0 ? "此期間的銷售紀錄都已經請款" : "此期間沒有可請款的銷售紀錄");
        }
        const statementNo = await nextStatementNo(tx, input.issuedAt);
        const issuedAt = startOfTaipeiDate(input.issuedAt);
        const dueDate = new Date(issuedAt);
        dueDate.setDate(dueDate.getDate() + preview.channel.paymentTermsDays);
        const statement = await tx.billingStatement.create({
          data: {
            statementNo,
            channelId: input.channelId,
            sourceType: preview.sourceType,
            periodStart: startOfTaipeiDate(input.periodStart),
            periodEnd: endOfTaipeiDate(input.periodEnd),
            issuedAt,
            dueDate,
            companyName: preview.channel.companyName,
            taxId: preview.channel.taxId,
            contactName: preview.channel.contactName,
            contactEmail: preview.channel.contactEmail,
            contactPhone: preview.channel.contactPhone,
            billingAddress: preview.channel.billingAddress,
            settlementRate: input.settlementRate,
            taxRate: input.taxRate,
            subtotal: preview.subtotal,
            taxAmount: preview.taxAmount,
            shippingFee: preview.shippingFee,
            totalAmount: preview.totalAmount,
            status: "ISSUED",
            note: input.note || null,
            createdById: actor.userId,
            items: {
              create: preview.items.map((item) => ({
                productId: item.productId,
                sku: item.sku,
                productName: item.productName,
                size: item.size,
                listPrice: item.listPrice,
                settlementPrice: item.settlementPrice,
                quantity: item.quantity,
                subtotal: item.subtotal,
              })),
            },
            sources: {
              create: preview.items.flatMap((item) => item.movementIds.map((movementId) => ({ movementId }))),
            },
          },
          include: { items: true, channel: true },
        });
        await tx.auditLog.create({
          data: {
            userId: actor.userId,
            action: "BILLING_STATEMENT_CREATED",
            entityType: "BillingStatement",
            entityId: statement.id,
            metadata: { statementNo, channelId: input.channelId, totalAmount: preview.totalAmount, sourceMovementCount: preview.sourceMovementCount },
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
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: "BILLING_STATEMENT_PAID",
        entityType: "BillingStatement",
        entityId: id,
        metadata: { statementNo: existing.statementNo, paidAmount: input.paidAmount },
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
    await tx.billingStatementSource.deleteMany({ where: { statementId: id } });
    const updated = await tx.billingStatement.update({
      where: { id },
      data: { status: "VOID" },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: "BILLING_STATEMENT_VOIDED",
        entityType: "BillingStatement",
        entityId: id,
        metadata: {
          statementNo: existing.statementNo,
          releasedSourceCount: movementIds.length,
          movementIds,
        },
        ipAddress: actor.ipAddress ?? null,
      },
    });
    return updated;
  });
}
