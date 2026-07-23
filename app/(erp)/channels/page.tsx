import { prisma } from "@/lib/prisma";
import { ChannelManager } from "@/components/ChannelManager";
import { getCurrentUser } from "@/lib/auth";

export default async function ChannelsPage() {
  const [channels, user] = await Promise.all([
    prisma.channel.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      include: { _count: { select: { movements: true } } },
    }),
    getCurrentUser(),
  ]);
  return <ChannelManager canWrite={user?.role !== "VIEWER"} channels={channels.map(({ _count, ...channel }) => ({ ...channel, movementCount: _count.movements }))} />;
}
