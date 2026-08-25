import { redirect } from "next/navigation";
import { ApiKeyManager } from "@/components/ApiKeyManager";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ApiKeysSettingsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/");

  const apiKeys = await prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, active: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });

  return <ApiKeyManager
    initialApiKeys={apiKeys.map((apiKey) => ({
      ...apiKey,
      createdAt: apiKey.createdAt.toISOString(),
      lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
      revokedAt: apiKey.revokedAt?.toISOString() ?? null,
    }))}
  />;
}
