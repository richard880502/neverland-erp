import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getInventoryRows } from "@/lib/data";
import { ShipmentManager } from "@/components/ShipmentManager";

const taipeiDate = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
const num = (value: unknown) => (value == null ? null : Number(value));

export default async function ShipmentsPage() {
  const [channels, products, inventory, shipments, user] = await Promise.all([
    prisma.channel.findMany({ where: { active: true, type: { in: ["CONSIGNMENT", "BUYOUT"] } }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { active: true }, orderBy: { sku: "asc" } }),
    getInventoryRows(),
    prisma.shipment.findMany({ include: { channel: true, lines: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    getCurrentUser(),
  ]);
  const claimed = new Set((await prisma.billingShippingClaim.findMany({
    where: { groupKey: { in: shipments.map((s) => `SHIPMENT:${s.id}`) } },
    select: { groupKey: true },
  })).map((claim) => claim.groupKey));
  const warehouse = new Map(inventory.map((row) => [row.id, row.warehouse]));

  return <ShipmentManager canWrite={user?.role === "ADMIN" || user?.role === "STAFF"}
    channels={channels.map((c) => ({
      id: c.id, name: c.name, type: c.type, contactName: c.contactName, contactPhone: c.contactPhone, billingAddress: c.billingAddress,
      settlementRate: num(c.settlementRate), defaultShippingMethod: c.defaultShippingMethod, defaultShippingFee: num(c.defaultShippingFee), defaultShippingPayer: c.defaultShippingPayer,
      hasShippingSheet: Boolean(c.shippingWorkbookId && c.shippingTemplateTab),
    }))}
    products={products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, size: p.size, listPrice: num(p.listPrice), warehouse: warehouse.get(p.id) ?? 0 }))}
    shipments={shipments.map((s) => ({
      id: s.id, channelId: s.channelId, channel: s.channel.name, kind: s.kind, status: s.status,
      createdDate: taipeiDate(s.createdAt), plannedDate: s.plannedDate ? taipeiDate(s.plannedDate) : "", dispatchedAt: s.dispatchedAt?.toISOString() ?? null,
      recipient: s.recipient ?? "", contactPhone: s.contactPhone ?? "", address: s.address ?? "", note: s.note ?? "", shippingMethod: s.shippingMethod ?? "",
      freight: s.freightActual != null && s.freightPaid != null && s.freightRecoverable != null ? { actual: Number(s.freightActual), paid: Number(s.freightPaid), recoverable: Number(s.freightRecoverable) } : null,
      freightClaimed: claimed.has(`SHIPMENT:${s.id}`),
      sheetUrl: s.sheetUrl,
      lines: s.lines.map((l) => ({ productId: l.productId, sku: l.sku, name: l.name, size: l.size, quantity: l.quantity, retailPrice: Number(l.retailPrice), tradePrice: Number(l.tradePrice) })),
    }))} />;
}
