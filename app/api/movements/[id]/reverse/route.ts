import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deltas, sumInventory } from "@/lib/inventory";
import { enqueueGoogleSheetMovement } from "@/lib/google-sheet-movement-queue";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] }); const { id } = await context.params;
    await prisma.$transaction(async (tx) => {
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
      const reversal = await tx.stockMovement.create({ data: {
        occurredAt: now, type: original.type, quantity: -original.quantity, unitPrice: original.unitPrice,
        referenceNo: original.referenceNo, note: `沖銷：${original.note ?? original.id}`,
        productId: original.productId, channelId: original.channelId, createdById: auth.user.id, reversalOfId: original.id,
      }});
      await enqueueGoogleSheetMovement(tx, reversal.id);
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "MOVEMENT_REVERSED", entityType: "StockMovement", entityId: original.id, metadata: { type: original.type, quantity: original.quantity }, ipAddress: clientIp(request) } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "沖銷失敗" }, { status: 409 });
  }
}
