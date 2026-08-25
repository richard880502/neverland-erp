import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createApiKey(label: string) {
  const plaintext = randomBytes(32).toString("hex");
  const keyHash = tokenHash(plaintext);

  const apiKey = await prisma.apiKey.create({ data: { keyHash, label } });

  return { id: apiKey.id, label: apiKey.label, plaintext };
}
