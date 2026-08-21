import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { McpAuth } from "@/lib/mcp/oauth";

const PREPARE_TTL_MS = 5 * 60_000;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

function samePayload(left: unknown, right: unknown) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export async function prepareMcpAction(kind: string, payload: Prisma.InputJsonValue, auth: McpAuth, preview: unknown) {
  const confirmationToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PREPARE_TTL_MS);
  await prisma.mcpPreparedAction.create({ data: { tokenHash: hash(confirmationToken), kind, payload, userId: auth.userId, connectionId: auth.connectionId, clientId: auth.clientId, expiresAt } });
  return { requiresConfirmation: true, confirmationToken, expiresAt, preview, instruction: "請向使用者顯示 preview；只有在使用者明確確認後，才以完全相同參數加上 confirmationToken 再呼叫一次。" };
}

export async function consumeMcpAction(kind: string, confirmationToken: string, payload: Prisma.InputJsonValue, auth: McpAuth) {
  const prepared = await prisma.mcpPreparedAction.findUnique({ where: { tokenHash: hash(confirmationToken) } });
  if (!prepared || prepared.kind !== kind || prepared.userId !== auth.userId || prepared.connectionId !== auth.connectionId || prepared.clientId !== auth.clientId || prepared.consumedAt || prepared.expiresAt <= new Date() || !samePayload(prepared.payload, payload)) throw new Error("confirmationToken 無效、已使用、已過期，或操作參數已改變；請重新取得 preview");
  const consumed = await prisma.mcpPreparedAction.updateMany({ where: { id: prepared.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
  if (consumed.count !== 1) throw new Error("confirmationToken 已使用；請重新取得 preview");
}
