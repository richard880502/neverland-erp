import { prisma } from "@/lib/prisma";
import { ChannelManager } from "@/components/ChannelManager";
import { getCurrentUser } from "@/lib/auth";

export default async function ChannelsPage() {
  const [channels, user] = await Promise.all([
    prisma.channel.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      include: { _count: { select: { movements: true, billingStatements: true } } },
    }),
    getCurrentUser(),
  ]);
  const canWrite = user?.role !== "VIEWER";

  return <ChannelManager canWrite={canWrite} channels={channels.map(({ _count, settlementRate, taxRate, defaultShippingFee, ...channel }) => ({
    ...channel,
    settlementRate: settlementRate == null ? null : Number(settlementRate),
    taxRate: taxRate == null ? null : Number(taxRate),
    defaultShippingFee: defaultShippingFee == null ? null : Number(defaultShippingFee),
    movementCount: _count.movements,
    billingCount: _count.billingStatements,
  }))} />;
}
