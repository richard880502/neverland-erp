import { prisma } from "@/lib/prisma";

const movementLabels: Record<string, string> = {
  SHIP: "出貨 / 銷售",
  SALES_RETURN: "銷貨退回",
};

function settlementIdFromSourceRef(sourceRef: string | null) {
  if (!sourceRef) return null;
  if (sourceRef.startsWith("RETURN:DIRECT_SETTLEMENT:")) {
    const id = sourceRef.slice("RETURN:DIRECT_SETTLEMENT:".length);
    return id || null;
  }
  if (!sourceRef.startsWith("DIRECT_SETTLEMENT:")) return null;
  const rest = sourceRef.slice("DIRECT_SETTLEMENT:".length);
  const id = rest.split(":", 1)[0];
  return id || null;
}

export async function getDirectSettlementFinanceTrace(sourceRef: string | null) {
  const settlementId = settlementIdFromSourceRef(sourceRef);
  if (!settlementId) return null;
  const settlement = await prisma.directSettlement.findUnique({ where: { id: settlementId } });
  if (!settlement) return null;

  const [channel, sourceRows] = await Promise.all([
    prisma.channel.findUnique({ where: { id: settlement.channelId }, select: { id: true, name: true } }),
    prisma.directSettlementSource.findMany({ where: { settlementId }, select: { movementId: true } }),
  ]);
  const movements = sourceRows.length > 0
    ? await prisma.stockMovement.findMany({
        where: { id: { in: sourceRows.map((row) => row.movementId) } },
        include: { product: { select: { id: true, sku: true, name: true, size: true } } },
        orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
      })
    : [];

  return {
    id: settlement.id,
    settlementNo: settlement.settlementNo,
    channelId: settlement.channelId,
    channelName: channel?.name ?? settlement.channelId,
    status: settlement.status,
    periodStart: settlement.periodStart,
    periodEnd: settlement.periodEnd,
    settledAt: settlement.settledAt,
    grossSales: Number(settlement.grossSales),
    shippingIncome: Number(settlement.shippingIncome),
    refundAmount: Number(settlement.refundAmount),
    platformFee: Number(settlement.platformFee),
    paymentFee: Number(settlement.paymentFee),
    otherFee: Number(settlement.otherFee),
    expectedPayout: Number(settlement.expectedPayout),
    actualPayout: settlement.actualPayout == null ? null : Number(settlement.actualPayout),
    discrepancy: settlement.discrepancy == null ? null : Number(settlement.discrepancy),
    payoutReference: settlement.payoutReference,
    sourceMovementCount: movements.length,
    sourceMovements: movements.map((movement) => ({
      id: movement.id,
      occurredAt: movement.occurredAt,
      type: movement.type,
      typeLabel: movementLabels[movement.type] ?? movement.type,
      quantity: movement.quantity,
      unitPrice: movement.unitPrice == null ? null : Number(movement.unitPrice),
      referenceNo: movement.referenceNo,
      productId: movement.product.id,
      sku: movement.product.sku,
      productName: movement.product.name,
      size: movement.product.size,
    })),
  };
}
