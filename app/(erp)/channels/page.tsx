import { prisma } from "@/lib/prisma";
import { ChannelManager } from "@/components/ChannelManager";
import { ChannelShippingDefaults } from "@/components/ChannelShippingDefaults";
import { getCurrentUser } from "@/lib/auth";

type ShippingDefaultRow = {
  id: string;
  defaultShippingMethod: string | null;
  defaultShippingFee: unknown;
  defaultShippingPayer: string | null;
};

export default async function ChannelsPage() {
  const [channels, shippingDefaults, user] = await Promise.all([
    prisma.channel.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      include: { _count: { select: { movements: true, billingStatements: true } } },
    }),
    prisma.$queryRaw<ShippingDefaultRow[]>`
      SELECT "id", "defaultShippingMethod", "defaultShippingFee", "defaultShippingPayer"
      FROM "Channel"
    `,
    getCurrentUser(),
  ]);
  const canWrite = user?.role !== "VIEWER";
  const defaultsById = new Map(shippingDefaults.map((row) => [row.id, row]));

  return <>
    <ChannelManager canWrite={canWrite} channels={channels.map(({ _count, settlementRate, taxRate, ...channel }) => ({
      ...channel,
      settlementRate: settlementRate == null ? null : Number(settlementRate),
      taxRate: taxRate == null ? null : Number(taxRate),
      movementCount: _count.movements,
      billingCount: _count.billingStatements,
    }))} />
    <ChannelShippingDefaults canWrite={canWrite} channels={channels.map((channel) => {
      const defaults = defaultsById.get(channel.id);
      return {
        id: channel.id,
        name: channel.name,
        active: channel.active,
        defaultShippingMethod: defaults?.defaultShippingMethod ?? null,
        defaultShippingFee: defaults?.defaultShippingFee == null ? null : Number(defaults.defaultShippingFee),
        defaultShippingPayer: defaults?.defaultShippingPayer ?? null,
      };
    })} />
  </>;
}
