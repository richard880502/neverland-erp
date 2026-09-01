import { randomUUID } from "node:crypto";
import { Prisma, type UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { deltas, isSale, sumInventory } from "@/lib/inventory";
import { enqueueGoogleSheetMovement } from "@/lib/google-sheet-movement-queue";

export const movementTypeSchema = z.enum(["RECEIVE", "SHIP", "SALES_RETURN", "PURCHASE_RETURN", "CONSIGN_OUT", "CONSIGN_RETURN", "CONSIGN_SOLD", "BUYOUT", "DEFECT", "ADJUSTMENT"]);
const shippingPayerSchema = z.enum(["COMPANY", "CUSTOMER", "CHANNEL", "SUPPLIER"]);

export const movementInputSchema = z.object({
  occurredAt: z.coerce.date().optional(),
  type: movementTypeSchema,
  productId: z.string().min(1),
  channelId: z.string().optional(),
  quantity: z.coerce.number().int().positive(),
  unitPrice: z.union([z.literal(""), z.coerce.number().min(0)]).optional(),
  referenceNo: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  shippingMethod: z.string().trim().max(120).optional(),
  shippingFee: z.union([z.literal(""), z.coerce.number().min(0).max(1_000_000)]).optional(),
  shippingPayer: z.union([z.literal(""), shippingPayerSchema]).optional(),
  shippingGroupKey: z.string().trim().max(120).optional(),
});

export const consignmentDirectFulfillmentSchema = z.object({
  occurredAt: z.coerce.date().optional(),
  productId: z.string().min(1),
  sourceChannelId: z.string().min(1),
  salesChannelId: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().min(0),
  referenceNo: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

export type MovementInput = z.infer<typeof movementInputSchema>;
export type ConsignmentDirectFulfillmentInput = z.infer<typeof consignmentDirectFulfillmentSchema>;
export type MovementActor = { userId: string; role: UserRole; ipAddress?: string | null; source?: "WEB" | "MCP"; connectionId?: string; clientId?: string };

type ShippingDefaultsRow = {
  defaultShippingMethod: string | null;
  defaultShippingFee: Prisma.Decimal | null;
  defaultShippingPayer: string | null;
};

type ShippingMovementRow = {
  shippingGroupKey: string | null;
};

const SERIALIZABLE_RETRY_LIMIT = 4;
const SHIPPING_MOVEMENT_TYPES = new Set<z.infer<typeof movementTypeSchema>>(["RECEIVE", "SHIP", "SALES_RETURN", "PURCHASE_RETURN", "CONSIGN_OUT", "CONSIGN_RETURN", "BUYOUT"]);
const movementFinanceLabels: Record<z.infer<typeof movementTypeSchema>, string> = {
  RECEIVE: "進貨",
  SHIP: "出貨",
  SALES_RETURN: "銷貨退回",
  PURCHASE_RETURN: "進貨退出",
  CONSIGN_OUT: "寄賣出貨",
  CONSIGN_RETURN: "寄賣退回",
  CONSIGN_SOLD: "寄賣售出",
  BUYOUT: "買斷",
  DEFECT: "瑕疵",
  ADJUSTMENT: "庫存調整",
};

function assertCanWrite(actor: MovementActor) {
  if (actor.role !== "ADMIN" && actor.role !== "STAFF") throw new Error("FORBIDDEN");
}

function isRetryableSerializableError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2034";
}

async function serializableTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableSerializableError(error) || attempt === SERIALIZABLE_RETRY_LIMIT) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (2 ** (attempt - 1))));
    }
  }
  throw new Error("庫存交易重試失敗");
}

function hasExplicitShipping(input: MovementInput) {
  return Boolean(
    input.shippingMethod?.trim()
      || (input.shippingFee !== undefined && input.shippingFee !== "")
      || (input.shippingPayer !== undefined && input.shippingPayer !== "")
  );
}

async function resolveMovementShipping(tx: Prisma.TransactionClient, input: MovementInput) {
  const supportsShipping = SHIPPING_MOVEMENT_TYPES.has(input.type);
  if (!supportsShipping && hasExplicitShipping(input)) throw new Error("這個庫存事件不會產生收送貨物流，請清除物流欄位");
  if (!supportsShipping) return null;

  const defaults = input.channelId
    ? (await tx.$queryRaw<ShippingDefaultsRow[]>(Prisma.sql`
        SELECT "defaultShippingMethod", "defaultShippingFee", "defaultShippingPayer"
        FROM "Channel"
        WHERE "id" = ${input.channelId}
        LIMIT 1
      `))[0]
    : undefined;

  const explicitFee = input.shippingFee === undefined || input.shippingFee === "" ? undefined : Number(input.shippingFee);
  const defaultFee = defaults?.defaultShippingFee == null ? undefined : Number(defaults.defaultShippingFee);
  const fee = explicitFee ?? defaultFee ?? 0;
  const method = input.shippingMethod?.trim() || defaults?.defaultShippingMethod?.trim() || null;
  const payer = input.shippingPayer
    ? input.shippingPayer
    : defaults?.defaultShippingPayer || (fee > 0 ? "COMPANY" : null);
  const hasShipping = Boolean(method || fee > 0 || payer);
  if (!hasShipping) return null;

  return {
    method,
    fee,
    payer,
    groupKey: input.shippingGroupKey?.trim() || randomUUID(),
  };
}

async function syncShippingExpense(tx: Prisma.TransactionClient, input: MovementInput, actor: MovementActor, movement: { id: string; occurredAt: Date; channelId: string | null }, productName: string, channelName: string | null, shipping: NonNullable<Awaited<ReturnType<typeof resolveMovementShipping>>>) {
  if (shipping.fee <= 0 || shipping.payer !== "COMPANY") return null;
  const sourceRef = `MOVEMENT_SHIPPING:${shipping.groupKey}`;
  const existing = await tx.financeTransaction.findFirst({ where: { sourceRef }, select: { id: true } });
  if (existing) return existing.id;

  const categoryCode = input.type === "RECEIVE" || input.type === "PURCHASE_RETURN" ? "inbound_shipping" : "shipping";
  const category = await tx.financeCategory.findUnique({ where: { code: categoryCode }, select: { id: true } });
  if (!category) throw new Error(`找不到財務運費分類 ${categoryCode}`);

  const financeId = randomUUID();
  await tx.financeTransaction.create({ data: {
    id: financeId,
    occurredAt: movement.occurredAt,
    direction: "EXPENSE",
    amount: shipping.fee,
    categoryId: category.id,
    counterparty: shipping.method ?? "物流費",
    relatedParty: channelName,
    salesChannel: null,
    summary: `${channelName ? `${channelName} · ` : ""}${movementFinanceLabels[input.type]}運費`,
    channelId: movement.channelId,
    source: "OTHER",
    sourceRef,
    paymentStatus: "PAID",
    reconciliationStatus: "UNMATCHED",
    invoiceStatus: "MISSING",
    note: [
      `由庫存異動自動建立`,
      `商品：${productName}`,
      input.referenceNo ? `單號：${input.referenceNo}` : null,
    ].filter(Boolean).join("；"),
    createdById: actor.userId,
  } });
  await tx.auditLog.create({ data: {
    userId: actor.userId,
    action: "MOVEMENT_SHIPPING_FINANCE_CREATED",
    entityType: "FinanceTransaction",
    entityId: financeId,
    metadata: { movementId: movement.id, shippingGroupKey: shipping.groupKey, shippingMethod: shipping.method, shippingFee: shipping.fee, channelId: movement.channelId },
    ipAddress: actor.ipAddress ?? null,
  }});
  return financeId;
}

export async function createInventoryMovement(input: MovementInput, actor: MovementActor) {
  assertCanWrite(actor);
  const requiresChannel = ["SHIP", "SALES_RETURN", "CONSIGN_OUT", "CONSIGN_RETURN", "CONSIGN_SOLD", "BUYOUT"].includes(input.type);
  if (requiresChannel && !input.channelId) throw new Error("此事件必須選擇通路");
  if (isSale(input.type) && (input.unitPrice === "" || input.unitPrice == null)) throw new Error("銷售事件請填入銷售單價，才能正確分析營收");

  return serializableTransaction(async (tx) => {
    const [product, channel, existing] = await Promise.all([
      tx.product.findUnique({ where: { id: input.productId } }),
      input.channelId ? tx.channel.findUnique({ where: { id: input.channelId } }) : null,
      tx.stockMovement.findMany({ where: { productId: input.productId } }),
    ]);
    if (!product) throw new Error("找不到商品");
    if (input.channelId && !channel) throw new Error("找不到通路");
    if (["CONSIGN_OUT", "CONSIGN_RETURN", "CONSIGN_SOLD"].includes(input.type) && channel?.type !== "CONSIGNMENT") throw new Error("寄賣事件只能選擇寄賣通路");
    const total = sumInventory(existing);
    if (["SHIP", "PURCHASE_RETURN", "CONSIGN_OUT", "BUYOUT", "DEFECT"].includes(input.type) && total.warehouse < input.quantity) throw new Error(`倉庫庫存不足，目前只有 ${total.warehouse} 件`);
    if (input.type === "SALES_RETURN") {
      const soldAtChannel = existing.filter((m) => m.channelId === input.channelId).reduce((sum, m) => sum + deltas(m.type, m.quantity).sold, 0);
      if (soldAtChannel < input.quantity) throw new Error(`${channel?.name ?? "此通路"} 可退回的已售數量不足，目前只有 ${soldAtChannel} 件`);
    }
    if (["CONSIGN_RETURN", "CONSIGN_SOLD"].includes(input.type)) {
      const atChannel = existing.filter((m) => m.channelId === input.channelId).reduce((sum, m) => sum + deltas(m.type, m.quantity).consignment, 0);
      if (atChannel < input.quantity) throw new Error(`${channel?.name} 的寄賣庫存不足，目前只有 ${atChannel} 件`);
    }

    const shipping = await resolveMovementShipping(tx, input);
    const created = await tx.stockMovement.create({ data: {
      occurredAt: input.occurredAt ?? new Date(), type: input.type, productId: input.productId, channelId: input.channelId || null,
      quantity: input.quantity, unitPrice: input.unitPrice === "" ? null : input.unitPrice, referenceNo: input.referenceNo || null,
      note: input.note || null, createdById: actor.userId,
    } });

    if (shipping) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "StockMovement"
        SET
          "shippingMethod" = ${shipping.method},
          "shippingFee" = ${shipping.fee},
          "shippingPayer" = ${shipping.payer},
          "shippingGroupKey" = ${shipping.groupKey}
        WHERE "id" = ${created.id}
      `);
      await syncShippingExpense(tx, input, actor, created, product.name, channel?.name ?? null, shipping);
    }

    await enqueueGoogleSheetMovement(tx, created.id);
    await tx.auditLog.create({ data: { userId: actor.userId, action: "MOVEMENT_CREATED", entityType: "StockMovement", entityId: created.id,
      metadata: {
        type: created.type,
        quantity: created.quantity,
        productId: created.productId,
        source: actor.source ?? "WEB",
        connectionId: actor.connectionId,
        clientId: actor.clientId,
        shipping: shipping ? { method: shipping.method, fee: shipping.fee, payer: shipping.payer, groupKey: shipping.groupKey } : null,
      }, ipAddress: actor.ipAddress ?? null } });
    return created;
  });
}

export async function createConsignmentDirectFulfillment(input: ConsignmentDirectFulfillmentInput, actor: MovementActor) {
  assertCanWrite(actor);
  if (input.sourceChannelId === input.salesChannelId) throw new Error("寄賣來源與銷售通路不可相同");

  return serializableTransaction(async (tx) => {
    const [product, sourceChannel, salesChannel, existing] = await Promise.all([
      tx.product.findUnique({ where: { id: input.productId } }),
      tx.channel.findUnique({ where: { id: input.sourceChannelId } }),
      tx.channel.findUnique({ where: { id: input.salesChannelId } }),
      tx.stockMovement.findMany({ where: { productId: input.productId } }),
    ]);
    if (!product) throw new Error("找不到商品");
    if (!sourceChannel || sourceChannel.type !== "CONSIGNMENT") throw new Error("寄賣代發來源必須是寄賣通路");
    if (!salesChannel || salesChannel.type !== "DIRECT") throw new Error("寄賣代發銷售歸屬必須是直營通路");

    const atSource = existing.filter((m) => m.channelId === input.sourceChannelId).reduce((sum, m) => sum + deltas(m.type, m.quantity).consignment, 0);
    if (atSource < input.quantity) throw new Error(`${sourceChannel.name} 的寄賣庫存不足，目前只有 ${atSource} 件`);

    const occurredAt = input.occurredAt ?? new Date();
    const commonNote = ["寄賣代發", input.note].filter(Boolean).join("；");
    const returned = await tx.stockMovement.create({ data: {
      occurredAt, type: "CONSIGN_RETURN", productId: input.productId, channelId: input.sourceChannelId,
      quantity: input.quantity, unitPrice: null, referenceNo: input.referenceNo || null,
      note: commonNote, createdById: actor.userId,
    } });
    const shipped = await tx.stockMovement.create({ data: {
      occurredAt, type: "SHIP", productId: input.productId, channelId: input.salesChannelId,
      quantity: input.quantity, unitPrice: input.unitPrice, referenceNo: input.referenceNo || null,
      note: commonNote, createdById: actor.userId,
    } });
    await enqueueGoogleSheetMovement(tx, returned.id);
    await enqueueGoogleSheetMovement(tx, shipped.id);
    await tx.auditLog.create({ data: {
      userId: actor.userId, action: "CONSIGNMENT_DIRECT_FULFILLMENT_CREATED", entityType: "StockMovement", entityId: shipped.id,
      metadata: { returnedMovementId: returned.id, shippedMovementId: shipped.id, productId: input.productId, quantity: input.quantity, sourceChannelId: input.sourceChannelId, salesChannelId: input.salesChannelId, source: actor.source ?? "WEB", connectionId: actor.connectionId, clientId: actor.clientId },
      ipAddress: actor.ipAddress ?? null,
    } });
    return { returned, shipped };
  });
}

export async function reverseInventoryMovement(id: string, actor: MovementActor) {
  assertCanWrite(actor);
  return serializableTransaction(async (tx) => {
    const original = await tx.stockMovement.findUnique({ where: { id }, include: { reversal: true, channel: true } });
    if (!original) throw new Error("找不到這筆異動");
    if (original.reversal || original.reversedAt || original.reversalOfId) throw new Error("這筆異動已沖銷或不可再次沖銷");
    const shippingRow = (await tx.$queryRaw<ShippingMovementRow[]>(Prisma.sql`
      SELECT "shippingGroupKey" FROM "StockMovement" WHERE "id" = ${id} LIMIT 1
    `))[0];
    const existing = await tx.stockMovement.findMany({ where: { productId: original.productId } });
    const current = sumInventory(existing); const reverseDelta = deltas(original.type, -original.quantity);
    if (current.warehouse + reverseDelta.warehouse < 0) throw new Error("沖銷後倉庫會出現負庫存，請先處理後續交易");
    if (current.sold + reverseDelta.sold < 0) throw new Error("沖銷後已售數量會出現負數，請先處理後續交易");
    if (reverseDelta.consignment < 0) {
      const atChannel = existing.filter((m) => m.channelId === original.channelId).reduce((sum, m) => sum + deltas(m.type, m.quantity).consignment, 0);
      if (atChannel + reverseDelta.consignment < 0) throw new Error("沖銷後通路會出現負庫存，請先處理後續交易");
    }
    const now = new Date();
    await tx.stockMovement.update({ where: { id }, data: { reversedAt: now } });
    const reversal = await tx.stockMovement.create({ data: { occurredAt: now, type: original.type, quantity: -original.quantity, unitPrice: original.unitPrice,
      referenceNo: original.referenceNo, note: `沖銷：${original.note ?? original.id}`, productId: original.productId, channelId: original.channelId,
      createdById: actor.userId, reversalOfId: original.id } });

    let shippingFinanceVoided = false;
    if (shippingRow?.shippingGroupKey) {
      const remaining = (await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS "count"
        FROM "StockMovement"
        WHERE "shippingGroupKey" = ${shippingRow.shippingGroupKey}
          AND "reversalOfId" IS NULL
          AND "reversedAt" IS NULL
      `))[0];
      if (Number(remaining?.count ?? 0) === 0) {
        const result = await tx.financeTransaction.updateMany({
          where: { sourceRef: `MOVEMENT_SHIPPING:${shippingRow.shippingGroupKey}`, paymentStatus: { not: "VOID" } },
          data: { paymentStatus: "VOID" },
        });
        shippingFinanceVoided = result.count > 0;
      }
    }

    await enqueueGoogleSheetMovement(tx, reversal.id);
    await tx.auditLog.create({ data: { userId: actor.userId, action: "MOVEMENT_REVERSED", entityType: "StockMovement", entityId: original.id,
      metadata: { type: original.type, quantity: original.quantity, shippingFinanceVoided, source: actor.source ?? "WEB", connectionId: actor.connectionId, clientId: actor.clientId }, ipAddress: actor.ipAddress ?? null } });
    return reversal;
  });
}