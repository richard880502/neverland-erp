import { Prisma, type UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { deltas, isSale, sumInventory } from "@/lib/inventory";
import { enqueueGoogleSheetMovement } from "@/lib/google-sheet-movement-queue";

export const movementInputSchema = z.object({
  occurredAt: z.coerce.date().optional(),
  type: z.enum(["RECEIVE", "SHIP", "CONSIGN_OUT", "CONSIGN_RETURN", "CONSIGN_SOLD", "BUYOUT", "DEFECT", "ADJUSTMENT"]),
  productId: z.string().min(1), channelId: z.string().optional(), quantity: z.coerce.number().int().positive(),
  unitPrice: z.union([z.literal(""), z.coerce.number().min(0)]).optional(), referenceNo: z.string().trim().max(120).optional(), note: z.string().trim().max(500).optional(),
});

export type MovementInput = z.infer<typeof movementInputSchema>;
export type MovementActor = { userId: string; role: UserRole; ipAddress?: string | null; source?: "WEB" | "MCP"; connectionId?: string; clientId?: string };

function assertCanWrite(actor: MovementActor) {
  if (actor.role !== "ADMIN" && actor.role !== "STAFF") throw new Error("FORBIDDEN");
}

/** The only domain write path used by both the browser API and MCP. */
export async function createInventoryMovement(input: MovementInput, actor: MovementActor) {
  assertCanWrite(actor);
  const requiresChannel = ["SHIP", "CONSIGN_OUT", "CONSIGN_RETURN", "CONSIGN_SOLD", "BUYOUT"].includes(input.type);
  if (requiresChannel && !input.channelId) throw new Error("此事件必須選擇通路");
  if (isSale(input.type) && (input.unitPrice === "" || input.unitPrice == null)) throw new Error("銷售事件請填入銷售單價，才能正確分析營收");

  return prisma.$transaction(async (tx) => {
    const [product, channel, existing] = await Promise.all([
      tx.product.findUnique({ where: { id: input.productId } }),
      input.channelId ? tx.channel.findUnique({ where: { id: input.channelId } }) : null,
      tx.stockMovement.findMany({ where: { productId: input.productId } }),
    ]);
    if (!product) throw new Error("找不到商品");
    if (input.channelId && !channel) throw new Error("找不到通路");
    if (["CONSIGN_OUT", "CONSIGN_RETURN", "CONSIGN_SOLD"].includes(input.type) && channel?.type !== "CONSIGNMENT") throw new Error("寄賣事件只能選擇寄賣通路");
    const total = sumInventory(existing);
    if (["SHIP", "CONSIGN_OUT", "BUYOUT", "DEFECT"].includes(input.type) && total.warehouse < input.quantity) throw new Error(`倉庫庫存不足，目前只有 ${total.warehouse} 件`);
    if (["CONSIGN_RETURN", "CONSIGN_SOLD"].includes(input.type)) {
      const atChannel = existing.filter((m) => m.channelId === input.channelId).reduce((sum, m) => sum + deltas(m.type, m.quantity).consignment, 0);
      if (atChannel < input.quantity) throw new Error(`${channel?.name} 的寄賣庫存不足，目前只有 ${atChannel} 件`);
    }
    const created = await tx.stockMovement.create({ data: {
      occurredAt: input.occurredAt ?? new Date(), type: input.type, productId: input.productId, channelId: input.channelId || null,
      quantity: input.quantity, unitPrice: input.unitPrice === "" ? null : input.unitPrice, referenceNo: input.referenceNo || null,
      note: input.note || null, createdById: actor.userId,
    } });
    await enqueueGoogleSheetMovement(tx, created.id);
    await tx.auditLog.create({ data: { userId: actor.userId, action: "MOVEMENT_CREATED", entityType: "StockMovement", entityId: created.id,
      metadata: { type: created.type, quantity: created.quantity, productId: created.productId, source: actor.source ?? "WEB", connectionId: actor.connectionId, clientId: actor.clientId }, ipAddress: actor.ipAddress ?? null } });
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reverseInventoryMovement(id: string, actor: MovementActor) {
  assertCanWrite(actor);
  return prisma.$transaction(async (tx) => {
    const original = await tx.stockMovement.findUnique({ where: { id }, include: { reversal: true, channel: true } });
    if (!original) throw new Error("找不到這筆異動");
    if (original.reversal || original.reversedAt || original.reversalOfId) throw new Error("這筆異動已沖銷或不可再次沖銷");
    const existing = await tx.stockMovement.findMany({ where: { productId: original.productId } });
    const current = sumInventory(existing); const reverseDelta = deltas(original.type, -original.quantity);
    if (current.warehouse + reverseDelta.warehouse < 0) throw new Error("沖銷後倉庫會出現負庫存，請先處理後續交易");
    if (reverseDelta.consignment < 0) {
      const atChannel = existing.filter((m) => m.channelId === original.channelId).reduce((sum, m) => sum + deltas(m.type, m.quantity).consignment, 0);
      if (atChannel + reverseDelta.consignment < 0) throw new Error("沖銷後通路會出現負庫存，請先處理後續交易");
    }
    const now = new Date();
    await tx.stockMovement.update({ where: { id }, data: { reversedAt: now } });
    const reversal = await tx.stockMovement.create({ data: { occurredAt: now, type: original.type, quantity: -original.quantity, unitPrice: original.unitPrice,
      referenceNo: original.referenceNo, note: `沖銷：${original.note ?? original.id}`, productId: original.productId, channelId: original.channelId,
      createdById: actor.userId, reversalOfId: original.id } });
    await enqueueGoogleSheetMovement(tx, reversal.id);
    await tx.auditLog.create({ data: { userId: actor.userId, action: "MOVEMENT_REVERSED", entityType: "StockMovement", entityId: original.id,
      metadata: { type: original.type, quantity: original.quantity, source: actor.source ?? "WEB", connectionId: actor.connectionId, clientId: actor.clientId }, ipAddress: actor.ipAddress ?? null } });
    return reversal;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
