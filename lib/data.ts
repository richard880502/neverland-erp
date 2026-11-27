import { prisma } from "@/lib/prisma";
import { deltas, isSale, salesSign, sumInventory } from "@/lib/inventory";
import { measureErpLoad } from "@/lib/erp-timing";

export async function getInventoryRows() {
  const [products, groupedMovements, channels] = await Promise.all([
    measureErpLoad("inventory.products", () => prisma.product.findMany({
      where: { active: true },
      select: { id: true, sku: true, name: true, size: true, imagePath: true, imageThumbPath: true, safetyStock: true },
      orderBy: [{ name: "asc" }, { size: "asc" }],
    })),
    measureErpLoad("inventory.movement-totals", () => prisma.stockMovement.groupBy({
      by: ["productId", "channelId", "type"],
      where: { product: { active: true }, quantity: { not: 0 } },
      _sum: { quantity: true },
    })),
    measureErpLoad("inventory.channels", () => prisma.channel.findMany({
      select: { id: true, name: true, type: true },
    })),
  ]);
  const groupedByProduct = new Map<string, typeof groupedMovements>();
  for (const movement of groupedMovements) {
    const rows = groupedByProduct.get(movement.productId) ?? [];
    rows.push(movement);
    groupedByProduct.set(movement.productId, rows);
  }
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  return products.map((product) => {
    const movements = groupedByProduct.get(product.id) ?? [];
    const totals = sumInventory(movements.map((movement) => ({
      type: movement.type,
      quantity: movement._sum.quantity ?? 0,
    })));
    const locationMap = new Map<string, { id: string; name: string; type: string; quantity: number }>();
    for (const movement of movements) {
      const channel = movement.channelId === null ? undefined : channelsById.get(movement.channelId);
      const direction = deltas(movement.type, 1).consignment;
      if (!channel || direction === 0) continue;
      // Keep locations whose real movements net to zero, as in the row-by-row ledger.
      const current = locationMap.get(channel.id) ?? { ...channel, quantity: 0 };
      current.quantity += direction * (movement._sum.quantity ?? 0);
      locationMap.set(channel.id, current);
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
    measureErpLoad("dashboard.inventory", getInventoryRows),
    measureErpLoad("dashboard.movements", () => prisma.stockMovement.findMany({
      select: {
        type: true, quantity: true, unitPrice: true, occurredAt: true, reversedAt: true, reversalOfId: true,
        product: { select: { name: true } },
        channel: { select: { id: true, name: true } },
      },
      orderBy: { occurredAt: "asc" },
    })),
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
