import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function requireApiKey(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new Error("UNAUTHORIZED");
  const key = match[1].trim();
  if (!key) throw new Error("UNAUTHORIZED");

  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: tokenHash(key) } });
  if (!apiKey || !apiKey.active || apiKey.revokedAt) throw new Error("UNAUTHORIZED");

  void prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return { apiKeyId: apiKey.id, label: apiKey.label };
}
