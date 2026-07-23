import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deltas, isSale, sumInventory } from "@/lib/inventory";
import { enqueueGoogleSheetMovement } from "@/lib/google-sheet-movement-queue";

const schema = z.object({
  occurredAt: z.coerce.date(), type: z.enum(["RECEIVE", "SHIP", "CONSIGN_OUT", "CONSIGN_RETURN", "CONSIGN_SOLD", "BUYOUT", "DEFECT", "ADJUSTMENT"]),
  productId: z.string().min(1), channelId: z.string().optional(), quantity: z.coerce.number().int().positive(),
  unitPrice: z.union([z.literal(""), z.coerce.number().min(0)]).optional(), referenceNo: z.string().trim().max(120).optional(), note: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] }); const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "請檢查日期、商品與數量" }, { status: 400 });
    const input = parsed.data;
    const requiresChannel = ["SHIP", "CONSIGN_OUT", "CONSIGN_RETURN", "CONSIGN_SOLD", "BUYOUT"].includes(input.type);
    if (requiresChannel && !input.channelId) return NextResponse.json({ error: "此事件必須選擇通路" }, { status: 400 });
    if (isSale(input.type) && (input.unitPrice === "" || input.unitPrice == null)) return NextResponse.json({ error: "銷售事件請填入銷售單價，才能正確分析營收" }, { status: 400 });

    const movement = await prisma.$transaction(async (tx) => {
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
        occurredAt: input.occurredAt, type: input.type, productId: input.productId, channelId: input.channelId || null,
        quantity: input.quantity, unitPrice: input.unitPrice === "" ? null : input.unitPrice, referenceNo: input.referenceNo || null,
        note: input.note || null, createdById: auth.user.id,
      }});
      await enqueueGoogleSheetMovement(tx, created.id);
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "MOVEMENT_CREATED", entityType: "StockMovement", entityId: created.id, metadata: { type: created.type, quantity: created.quantity, productId: created.productId }, ipAddress: clientIp(request) } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(movement, { status: 201 });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "異動無法儲存" }, { status: 409 });
  }
}
