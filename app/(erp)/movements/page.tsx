import { prisma } from "@/lib/prisma";
import { MovementManager } from "@/components/MovementManager";
import { getCurrentUser } from "@/lib/auth";

type ChannelShippingRow = {
  id: string;
  defaultShippingMethod: string | null;
  defaultShippingFee: unknown;
  defaultShippingPayer: string | null;
};

type MovementShippingRow = {
  id: string;
  shippingMethod: string | null;
  shippingFee: unknown;
  shippingPayer: string | null;
  shippingGroupKey: string | null;
};

export default async function MovementsPage() {
  const [products, channels, channelShipping, movements, movementShipping, user] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, orderBy: [{ name: "asc" }, { size: "asc" }] }),
    prisma.channel.findMany({ where: { active: true, type: { not: "SYSTEM" } }, orderBy: { name: "asc" } }),
    prisma.$queryRaw<ChannelShippingRow[]>`
      SELECT "id", "defaultShippingMethod", "defaultShippingFee", "defaultShippingPayer"
      FROM "Channel"
      WHERE "active" = true AND "type" <> 'SYSTEM'
    `,
    prisma.stockMovement.findMany({ include: { product: true, channel: true, createdBy: true, reversal: true }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], take: 100 }),
    prisma.$queryRaw<MovementShippingRow[]>`
      SELECT "id", "shippingMethod", "shippingFee", "shippingPayer", "shippingGroupKey"
      FROM "StockMovement"
      ORDER BY "occurredAt" DESC, "createdAt" DESC
      LIMIT 100
    `,
    getCurrentUser(),
  ]);
  const channelShippingById = new Map(channelShipping.map((row) => [row.id, row]));
  const movementShippingById = new Map(movementShipping.map((row) => [row.id, row]));

  return <MovementManager canWrite={user?.role !== "VIEWER"}
    products={products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, size: p.size, listPrice: p.listPrice ? Number(p.listPrice) : null }))}
    channels={channels.map((c) => {
      const shipping = channelShippingById.get(c.id);
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        defaultShippingMethod: shipping?.defaultShippingMethod ?? null,
        defaultShippingFee: shipping?.defaultShippingFee == null ? null : Number(shipping.defaultShippingFee),
        defaultShippingPayer: shipping?.defaultShippingPayer ?? null,
      };
    })}
    movements={movements.map((m) => {
      const shipping = movementShippingById.get(m.id);
      return {
        id: m.id, occurredAt: m.occurredAt.toISOString(), type: m.type, quantity: m.quantity,
        unitPrice: m.unitPrice ? Number(m.unitPrice) : null, referenceNo: m.referenceNo, note: m.note,
        shippingMethod: shipping?.shippingMethod ?? null,
        shippingFee: shipping?.shippingFee == null ? null : Number(shipping.shippingFee),
        shippingPayer: shipping?.shippingPayer ?? null,
        shippingGroupKey: shipping?.shippingGroupKey ?? null,
        product: {
          id: m.product.id,
          sku: m.product.sku,
          name: m.product.name,
          size: m.product.size,
          listPrice: m.product.listPrice ? Number(m.product.listPrice) : null,
        },
        channel: m.channel, createdBy: m.createdBy.name, reversedAt: m.reversedAt?.toISOString() ?? null,
        isReversal: Boolean(m.reversalOfId),
      };
    })}
  />;
}
