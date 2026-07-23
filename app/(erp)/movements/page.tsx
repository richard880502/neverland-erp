import { prisma } from "@/lib/prisma";
import { MovementManager } from "@/components/MovementManager";
import { getCurrentUser } from "@/lib/auth";

export default async function MovementsPage() {
  const [products, channels, movements, user] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, orderBy: [{ name: "asc" }, { size: "asc" }] }),
    prisma.channel.findMany({ where: { active: true, type: { not: "SYSTEM" } }, orderBy: { name: "asc" } }),
    prisma.stockMovement.findMany({ include: { product: true, channel: true, createdBy: true, reversal: true }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], take: 100 }),
    getCurrentUser(),
  ]);
  return <MovementManager canWrite={user?.role !== "VIEWER"}
    products={products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, size: p.size, listPrice: p.listPrice ? Number(p.listPrice) : null }))}
    channels={channels.map((c) => ({ id: c.id, name: c.name, type: c.type }))}
    movements={movements.map((m) => ({
      id: m.id, occurredAt: m.occurredAt.toISOString(), type: m.type, quantity: m.quantity,
      unitPrice: m.unitPrice ? Number(m.unitPrice) : null, referenceNo: m.referenceNo, note: m.note,
      product: {
        id: m.product.id,
        sku: m.product.sku,
        name: m.product.name,
        size: m.product.size,
        listPrice: m.product.listPrice ? Number(m.product.listPrice) : null,
      },
      channel: m.channel, createdBy: m.createdBy.name, reversedAt: m.reversedAt?.toISOString() ?? null,
      isReversal: Boolean(m.reversalOfId),
    }))}
  />;
}
