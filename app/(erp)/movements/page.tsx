import { Prisma, type MovementType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MovementManager } from "@/components/MovementManager";
import { getCurrentUser } from "@/lib/auth";

const movementTypes = new Set<MovementType>([
  "RECEIVE",
  "SHIP",
  "SALES_RETURN",
  "PURCHASE_RETURN",
  "CONSIGN_OUT",
  "CONSIGN_RETURN",
  "CONSIGN_SOLD",
  "BUYOUT",
  "DEFECT",
  "ADJUSTMENT",
]);
const pageSize = 100;

function validDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function dateAtStart(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dayAfter(value: string) {
  const date = dateAtStart(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; channel?: string; start?: string; end?: string; page?: string }> }) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 120);
  const requestedType = params.type ?? "";
  const type = movementTypes.has(requestedType as MovementType) ? requestedType as MovementType : "";
  const channel = (params.channel ?? "").trim();
  const start = validDate(params.start);
  const end = validDate(params.end);
  const rawPage = Number(params.page ?? "1");
  const requestedPage = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const occurredAt: Prisma.DateTimeFilter = {};
  if (start) occurredAt.gte = dateAtStart(start);
  if (end) occurredAt.lt = dayAfter(end);

  const where: Prisma.StockMovementWhereInput = {
    ...(type ? { type } : {}),
    ...(channel ? { channelId: channel } : {}),
    ...(start || end ? { occurredAt } : {}),
    ...(q ? {
      OR: [
        { referenceNo: { contains: q, mode: "insensitive" } },
        { note: { contains: q, mode: "insensitive" } },
        { shippingMethod: { contains: q, mode: "insensitive" } },
        { product: { is: { OR: [
          { sku: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
          { size: { contains: q, mode: "insensitive" } },
        ] } } },
        { channel: { is: { name: { contains: q, mode: "insensitive" } } } },
        { createdBy: { is: { name: { contains: q, mode: "insensitive" } } } },
      ],
    } : {}),
  };

  const [products, channels, total, user] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, orderBy: [{ name: "asc" }, { size: "asc" }] }),
    prisma.channel.findMany({ where: { active: true, type: { not: "SYSTEM" } }, orderBy: { name: "asc" } }),
    prisma.stockMovement.count({ where }),
    getCurrentUser(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const movements = await prisma.stockMovement.findMany({
    where,
    include: { product: true, channel: true, createdBy: true, reversal: true },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return <MovementManager
    canWrite={user?.role !== "VIEWER"}
    products={products.map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      size: product.size,
      listPrice: product.listPrice ? Number(product.listPrice) : null,
    }))}
    channels={channels.map((channelItem) => ({
      id: channelItem.id,
      name: channelItem.name,
      type: channelItem.type,
      defaultShippingMethod: channelItem.defaultShippingMethod,
      defaultShippingFee: channelItem.defaultShippingFee == null ? null : Number(channelItem.defaultShippingFee),
      defaultShippingPayer: channelItem.defaultShippingPayer,
    }))}
    filters={{ q, type, channel, start, end, page, pageSize, total, totalPages }}
    movements={movements.map((movement) => ({
      id: movement.id,
      occurredAt: movement.occurredAt.toISOString(),
      type: movement.type,
      quantity: movement.quantity,
      unitPrice: movement.unitPrice ? Number(movement.unitPrice) : null,
      referenceNo: movement.referenceNo,
      note: movement.note,
      shippingMethod: movement.shippingMethod,
      shippingFee: movement.shippingFee == null ? null : Number(movement.shippingFee),
      shippingPayer: movement.shippingPayer,
      shippingGroupKey: movement.shippingGroupKey,
      product: {
        id: movement.product.id,
        sku: movement.product.sku,
        name: movement.product.name,
        size: movement.product.size,
        listPrice: movement.product.listPrice ? Number(movement.product.listPrice) : null,
      },
      channel: movement.channel,
      createdBy: movement.createdBy.name,
      reversedAt: movement.reversedAt?.toISOString() ?? null,
      isReversal: Boolean(movement.reversalOfId),
    }))}
  />;
}
