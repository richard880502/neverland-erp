import { prisma } from "@/lib/prisma";

const movementLabels: Record<string, string> = {
  SHIP: "出貨",
  CONSIGN_SOLD: "寄賣售出",
  BUYOUT: "買斷",
  SALES_RETURN: "銷貨退回",
};

export async function getBillingFinanceTrace(sourceRef: string | null) {
  if (!sourceRef?.startsWith("BILLING:")) return null;
  const statementId = sourceRef.slice("BILLING:".length);
  if (!statementId) return null;

  const statement = await prisma.billingStatement.findUnique({
    where: { id: statementId },
    include: {
      channel: { select: { id: true, name: true } },
      sources: {
        include: {
          movement: {
            include: {
              product: { select: { id: true, sku: true, name: true, size: true } },
            },
          },
        },
      },
    },
  });
  if (!statement) return null;

  const sourceMovements = statement.sources
    .map((source) => source.movement)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((movement) => ({
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
    }));

  return {
    id: statement.id,
    statementNo: statement.statementNo,
    channelId: statement.channelId,
    channelName: statement.channel.name,
    sourceType: statement.sourceType,
    status: statement.status,
    periodStart: statement.periodStart,
    periodEnd: statement.periodEnd,
    issuedAt: statement.issuedAt,
    dueDate: statement.dueDate,
    subtotal: Number(statement.subtotal),
    taxAmount: Number(statement.taxAmount),
    shippingFee: Number(statement.shippingFee),
    totalAmount: Number(statement.totalAmount),
    sourceMovementCount: sourceMovements.length,
    sourceMovements,
  };
}
