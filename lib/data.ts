import { prisma } from "@/lib/prisma";
import { deltas, isSale, salesSign, sumInventory } from "@/lib/inventory";

export async function getInventoryRows() {
  const products = await prisma.product.findMany({
    where: { active: true },
    include: { movements: { include: { channel: { select: { id: true, name: true, type: true } } } } },
    orderBy: [{ name: "asc" }, { size: "asc" }],
  });
  return products.map((product) => {
    const totals = sumInventory(product.movements);
    const locationMap = new Map<string, { id: string; name: string; type: string; quantity: number }>();
    for (const movement of product.movements) {
      if (!movement.channel) continue;
      const quantity = deltas(movement.type, movement.quantity).consignment;
      if (quantity === 0) continue;
      const current = locationMap.get(movement.channel.id) ?? { ...movement.channel, quantity: 0 };
      current.quantity += quantity;
      locationMap.set(movement.channel.id, current);
    }
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      size: product.size,
      imagePath: product.imagePath,
      imageThumbPath: product.imageThumbPath,
      safetyStock: product.safetyStock,
      ...totals,
      total: totals.warehouse + totals.consignment,
      status: totals.warehouse <= product.safetyStock ? "補貨注意" : "正常",
      locations: [...locationMap.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "zh-Hant")),
    };
  });
}

export async function getDashboardData() {
  const [inventory, movements] = await Promise.all([
    getInventoryRows(),
    prisma.stockMovement.findMany({
      include: { product: true, channel: true },
      orderBy: { occurredAt: "asc" },
    }),
  ]);
  const sales = movements.filter((m) => isSale(m.type));
  const productNames = [...new Set(inventory.map((row) => row.name))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  const channelOptions = [...new Map(movements.filter((movement) => movement.channel).map((movement) => [movement.channel!.id, movement.channel!])).values()]
    .map((channel) => ({ id: channel.id, name: channel.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  const saleDates = sales.map((sale) => sale.occurredAt.toISOString().slice(0, 10));
  return {
    inventory: inventory.map((row) => ({
      productName: row.name,
      total: row.total,
      warehouse: row.warehouse,
      consignment: row.consignment,
      lowStock: row.status === "補貨注意",
      locations: row.locations.map((location) => ({ channelId: location.id, quantity: location.quantity })),
    })),
    sales: sales.map((sale) => ({
      date: sale.occurredAt.toISOString().slice(0, 10),
      productName: sale.product.name,
      channelId: sale.channel?.id ?? null,
      channelName: sale.channel?.name ?? "未指定",
      quantity: salesSign(sale.type) * sale.quantity,
      revenue: salesSign(sale.type) * Number(sale.unitPrice ?? 0) * sale.quantity,
      countsAsTransaction: sale.quantity > 0 && !sale.reversedAt && !sale.reversalOfId,
    })),
    filters: { products: productNames, channels: channelOptions },
    dateBounds: {
      min: saleDates[0] ?? new Date().toISOString().slice(0, 10),
      max: saleDates[saleDates.length - 1] ?? new Date().toISOString().slice(0, 10),
    },
  };
}
