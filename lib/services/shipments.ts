import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { ExplicitFreight, MovementActor } from "@/lib/services/movements";
import { assertFreight, createInventoryMovementInTransaction, serializableTransaction, syncShippingExpense, upsertShippingGroup } from "@/lib/services/movements";

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const optionalMoney = z.union([z.literal(""), z.null(), z.coerce.number().min(0).max(1_000_000)]).optional();

export const freightInputSchema = z.object({
  freightActual: optionalMoney,
  freightPaid: optionalMoney,
  freightRecoverable: optionalMoney,
});

export const shipmentInputSchema = z.object({
  channelId: z.string().min(1),
  kind: z.enum(["CONSIGNMENT", "BUYOUT"]).default("CONSIGNMENT"),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("")),
  recipient: optionalText(120), contactPhone: optionalText(120), address: optionalText(500), note: optionalText(1000),
  shippingMethod: optionalText(120),
  ...freightInputSchema.shape,
  lines: z.array(z.object({ productId: z.string().min(1), quantity: z.coerce.number().int().positive().max(1000000) })).min(1).max(100),
}).refine((v) => new Set(v.lines.map((line) => line.productId)).size === v.lines.length, { message: "同一商品不可重複" });
export type ShipmentInput = z.infer<typeof shipmentInputSchema>;
export type FreightInput = z.infer<typeof freightInputSchema>;

const shipmentGroupKey = (id: string) => `SHIPMENT:${id}`;
const lockShipment = (tx: Prisma.TransactionClient, id: string) => tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`shipment-sheet:${id}`}))::text`);

function assertWrite(actor: MovementActor) {
  if (actor.role !== "ADMIN" && actor.role !== "STAFF") throw new Error("FORBIDDEN");
}

/** Blank freight means "運費待確認"; otherwise all three amounts are required. */
export function freightFromInput(input: FreightInput): ExplicitFreight | null {
  const values = [input.freightActual, input.freightPaid, input.freightRecoverable].map((value) => (value === "" || value == null ? null : Number(value)));
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => value === null)) throw new Error("運費需同時填寫實際運費、我方支付與向通路回收，或三格都留空表示待確認");
  const freight = { actual: values[0]!, paid: values[1]!, recoverable: values[2]! };
  assertFreight(freight);
  return freight;
}

function freightFromShipment(shipment: { freightActual: Prisma.Decimal | null; freightPaid: Prisma.Decimal | null; freightRecoverable: Prisma.Decimal | null }): ExplicitFreight | null {
  if (shipment.freightActual == null || shipment.freightPaid == null || shipment.freightRecoverable == null) return null;
  return { actual: Number(shipment.freightActual), paid: Number(shipment.freightPaid), recoverable: Number(shipment.freightRecoverable) };
}

function freightColumns(freight: ExplicitFreight | null) {
  return { freightActual: freight?.actual ?? null, freightPaid: freight?.paid ?? null, freightRecoverable: freight?.recoverable ?? null };
}

export async function saveShipment(input: ShipmentInput, actor: MovementActor, id?: string) {
  assertWrite(actor);
  const freight = freightFromInput(input);
  return serializableTransaction(async (tx) => {
    if (id) await lockShipment(tx, id);
    const channel = await tx.channel.findUnique({ where: { id: input.channelId } });
    if (!channel?.active || !["CONSIGNMENT", "BUYOUT"].includes(channel.type)) throw new Error("請選擇有效的經銷通路");
    if (input.kind === "CONSIGNMENT" && channel.type !== "CONSIGNMENT") throw new Error("寄賣出貨需要寄賣通路");
    const products = await tx.product.findMany({ where: { id: { in: input.lines.map((line) => line.productId) }, active: true } });
    if (products.length !== input.lines.length || products.some((product) => product.listPrice == null)) throw new Error("商品不存在、已停用或尚未設定售價");
    const rate = input.kind === "BUYOUT" ? 0.5 : Number(channel.settlementRate ?? 0);
    if (rate <= 0 || rate > 1) throw new Error("請先設定通路寄賣結算比例");
    const byId = new Map(products.map((product) => [product.id, product]));
    const data = {
      channelId: input.channelId, kind: input.kind,
      plannedDate: input.plannedDate ? new Date(`${input.plannedDate}T00:00:00+08:00`) : null,
      recipient: input.recipient || null, contactPhone: input.contactPhone || null, address: input.address || null, note: input.note || null,
      shippingMethod: input.shippingMethod || null,
      ...freightColumns(freight),
    };
    let shipment;
    const existing = id ? await tx.shipment.findUnique({ where: { id }, include: { lines: true } }) : null;
    if (id) {
      if (!existing || existing.status !== "DRAFT") throw new Error("找不到可編輯的草稿");
      if (existing.sheetSpreadsheetId && existing.channelId !== input.channelId) throw new Error("已建立工作表的出貨單無法變更通路");
      shipment = await tx.shipment.update({ where: { id }, data });
      await tx.shipmentLine.deleteMany({ where: { shipmentId: id } });
    } else shipment = await tx.shipment.create({ data });
    await tx.shipmentLine.createMany({ data: input.lines.map((line) => {
      const product = byId.get(line.productId)!;
      const retailPrice = Number(product.listPrice);
      // Keep the original price snapshot while the deal terms stay the same.
      const snapshot = existing?.channelId === input.channelId && existing.kind === input.kind ? existing.lines.find((item) => item.productId === product.id) : undefined;
      return { shipmentId: shipment.id, productId: product.id, sku: snapshot?.sku ?? product.sku, name: snapshot?.name ?? product.name, size: snapshot ? snapshot.size : product.size, quantity: line.quantity, retailPrice: snapshot?.retailPrice ?? retailPrice, tradePrice: snapshot?.tradePrice ?? Math.round((retailPrice * rate + Number.EPSILON) * 100) / 100 };
    }) });
    await tx.auditLog.create({ data: { userId: actor.userId, action: id ? "SHIPMENT_DRAFT_UPDATED" : "SHIPMENT_DRAFT_CREATED", entityType: "Shipment", entityId: shipment.id, metadata: { freight }, ipAddress: actor.ipAddress ?? null } });
    return tx.shipment.findUniqueOrThrow({ where: { id: shipment.id }, include: { lines: true } });
  });
}

export async function deleteShipmentDraft(id: string, actor: MovementActor) {
  assertWrite(actor);
  return serializableTransaction(async (tx) => {
    await lockShipment(tx, id);
    const shipment = await tx.shipment.findUnique({ where: { id } });
    if (!shipment) throw new Error("找不到出貨單");
    if (shipment.status !== "DRAFT") throw new Error("已出貨的出貨單不可刪除");
    await tx.shipment.delete({ where: { id } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "SHIPMENT_DRAFT_DELETED", entityType: "Shipment", entityId: id, metadata: { sheetUrl: shipment.sheetUrl }, ipAddress: actor.ipAddress ?? null } });
    return { deleted: true, sheetUrl: shipment.sheetUrl };
  });
}

export async function dispatchShipment(id: string, actor: MovementActor) {
  assertWrite(actor);
  return serializableTransaction(async (tx) => {
    await lockShipment(tx, id);
    const shipment = await tx.shipment.findUnique({ where: { id }, include: { lines: true } });
    if (!shipment) throw new Error("找不到出貨單");
    if (shipment.status === "DISPATCHED") return shipment;
    if (!shipment.lines.length) throw new Error("出貨單沒有品項");
    const freight = freightFromShipment(shipment);
    const now = new Date();
    for (const line of shipment.lines) {
      const movement = await createInventoryMovementInTransaction(tx, {
        type: shipment.kind === "BUYOUT" ? "BUYOUT" : "CONSIGN_OUT", occurredAt: now,
        productId: line.productId, channelId: shipment.channelId, quantity: line.quantity,
        unitPrice: Number(line.tradePrice), referenceNo: shipment.id, note: shipment.note ?? undefined,
        shippingMethod: shipment.shippingMethod ?? undefined,
        shippingGroupKey: shipmentGroupKey(shipment.id),
        ...(freight ? { shippingActual: freight.actual, shippingPaid: freight.paid, shippingRecoverable: freight.recoverable } : {}),
      // Pending freight must not silently fall back to channel defaults; it is filled in later.
      }, actor, { skipShippingDefaults: true });
      await tx.shipmentLine.update({ where: { id: line.id }, data: { movementId: movement.id } });
    }
    const updated = await tx.shipment.update({ where: { id }, data: { status: "DISPATCHED", dispatchedAt: now }, include: { lines: true } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "SHIPMENT_DISPATCHED", entityType: "Shipment", entityId: id, metadata: { freight }, ipAddress: actor.ipAddress ?? null } });
    return updated;
  });
}

/** Fill in or correct freight after dispatch ("運費待確認" → actual amounts).
 * The ShippingGroup, the movements' legacy shipping columns and the single
 * Finance expense are kept in step; a group already billed is locked. */
export async function updateShipmentFreight(id: string, input: FreightInput, actor: MovementActor) {
  assertWrite(actor);
  const freight = freightFromInput(input);
  return serializableTransaction(async (tx) => {
    await lockShipment(tx, id);
    const shipment = await tx.shipment.findUnique({ where: { id }, include: { channel: true, lines: { include: { movement: { include: { product: true } } } } } });
    if (!shipment) throw new Error("找不到出貨單");
    if (shipment.status === "DRAFT") {
      const updated = await tx.shipment.update({ where: { id }, data: freightColumns(freight), include: { lines: true } });
      await tx.auditLog.create({ data: { userId: actor.userId, action: "SHIPMENT_FREIGHT_UPDATED", entityType: "Shipment", entityId: id, metadata: { freight }, ipAddress: actor.ipAddress ?? null } });
      return updated;
    }
    if (!freight) throw new Error("已出貨的出貨單請填寫完整運費");
    const movements = shipment.lines.map((line) => line.movement).filter((movement): movement is NonNullable<typeof movement> => Boolean(movement));
    if (!movements.length) throw new Error("找不到出貨單的庫存異動");
    if (freight.recoverable > 0 && !["CONSIGNMENT", "BUYOUT"].includes(shipment.channel.type)) throw new Error("向通路回收運費目前只適用寄賣與買斷通路");
    const groupKey = shipmentGroupKey(id);
    await upsertShippingGroup(tx, groupKey, shipment.channelId, freight, { allowUpdate: true });
    const payer = freight.paid > 0 ? "COMPANY" : "CHANNEL";
    await tx.$executeRaw(Prisma.sql`
      UPDATE "StockMovement"
      SET "shippingFee" = ${freight.paid}, "shippingPayer" = ${payer}, "shippingGroupKey" = ${groupKey},
          "shippingMethod" = COALESCE("shippingMethod", ${shipment.shippingMethod})
      WHERE "id" IN (${Prisma.join(movements.map((movement) => movement.id))})
    `);

    const sourceRef = `MOVEMENT_SHIPPING:${groupKey}`;
    const expense = await tx.financeTransaction.findFirst({ where: { sourceRef } });
    if (expense) {
      if (expense.reconciliationStatus !== "UNMATCHED" && Number(expense.amount) !== freight.paid) throw new Error("這筆運費支出已對帳，請先在財務管理取消對帳再修改");
      await tx.financeTransaction.update({ where: { id: expense.id }, data: freight.paid > 0 ? { amount: freight.paid, paymentStatus: "PAID" } : { paymentStatus: "VOID" } });
    } else if (freight.paid > 0) {
      const first = movements[0];
      await syncShippingExpense(tx, { type: first.type, productId: first.productId, channelId: shipment.channelId, quantity: first.quantity, referenceNo: shipment.id }, actor,
        { id: first.id, occurredAt: first.occurredAt, channelId: first.channelId }, first.product.name, shipment.channel.name,
        { method: shipment.shippingMethod, fee: freight.paid, payer, groupKey });
    }
    const updated = await tx.shipment.update({ where: { id }, data: freightColumns(freight), include: { lines: true } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "SHIPMENT_FREIGHT_UPDATED", entityType: "Shipment", entityId: id, metadata: { freight, groupKey }, ipAddress: actor.ipAddress ?? null } });
    return updated;
  });
}
