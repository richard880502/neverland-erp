import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { prisma } from "../../lib/prisma";
import {
  authenticateMcpAccessToken,
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  registerDynamicClient,
  revokeConnection,
  rotateRefreshToken,
} from "../../lib/mcp/oauth";
import { callMcpTool } from "../../lib/mcp/tools";
import type { McpAuth } from "../../lib/mcp/oauth";

const audience = "https://erp.example.com/mcp";

test.before(async () => {
  await prisma.user.deleteMany({ where: { email: { in: ["mcp-integration@example.com", "mcp-write-integration@example.com"] } } });
});

test.after(async () => {
  await prisma.googleSheetMovementQueue.deleteMany({ where: { movement: { product: { sku: "MCP-TEST-SKU" } } } });
  await prisma.stockMovement.deleteMany({ where: { product: { sku: "MCP-TEST-SKU" } } });
  await prisma.product.deleteMany({ where: { sku: "MCP-TEST-SKU" } });
  await prisma.user.deleteMany({ where: { email: { in: ["mcp-integration@example.com", "mcp-write-integration@example.com"] } } });
  await prisma.$disconnect();
});

test("high-risk write requires a single-use preview token and preserves domain invariants", async () => {
  const user = await prisma.user.create({ data: { email: "mcp-write-integration@example.com", name: "MCP Write Integration", passwordHash: "unused", role: "ADMIN", mustChangePassword: false } });
  const connection = await prisma.mcpConnection.create({ data: { userId: user.id, clientId: "write-integration", clientName: "Write integration", scopes: ["inventory:write"] } });
  const auth: McpAuth = { userId: user.id, role: user.role, scopes: ["inventory:write"], connectionId: connection.id, clientId: connection.clientId };
  const product = await prisma.product.create({ data: { sku: "MCP-TEST-SKU", name: "MCP Test Product" } });
  const command = { sku: product.sku, type: "RECEIVE", quantity: 3 };

  const prepared = await callMcpTool("create_inventory_movement", command, auth);
  const structured = prepared.structuredContent as { confirmationToken: string; requiresConfirmation: boolean };
  assert.equal(structured.requiresConfirmation, true);
  assert.equal(await prisma.stockMovement.count({ where: { productId: product.id } }), 0);

  const committed = await callMcpTool("create_inventory_movement", { ...command, confirmationToken: structured.confirmationToken }, auth);
  assert.equal((committed.structuredContent as { committed: boolean }).committed, true);
  assert.equal(await prisma.stockMovement.count({ where: { productId: product.id } }), 1);
  assert.equal(await prisma.googleSheetMovementQueue.count({ where: { movement: { productId: product.id } } }), 1);

  await assert.rejects(
    callMcpTool("create_inventory_movement", { ...command, confirmationToken: structured.confirmationToken }, auth),
    /已使用|無效/,
  );
});

test("authorization code, PKCE, audience, rotation, replay, and revoke", async () => {
  const user = await prisma.user.create({ data: { email: "mcp-integration@example.com", name: "MCP Integration", passwordHash: "unused", role: "ADMIN", mustChangePassword: false } });
  const redirectUri = "http://127.0.0.1:49152/callback/codex";
  const client = await registerDynamicClient({ redirectUris: [redirectUri], clientName: "Codex integration", applicationType: "native" });
  const verifier = "a".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const code = await issueAuthorizationCode({ userId: user.id, clientId: client.client_id, clientName: client.client_name, redirectUri, codeChallenge: challenge, scopes: ["inventory:read"], userAgent: "integration-test" });

  await assert.rejects(exchangeAuthorizationCode({ code, clientId: client.client_id, redirectUri, codeVerifier: "wrong".repeat(12), audience }), /invalid_grant/);
  const first = await exchangeAuthorizationCode({ code, clientId: client.client_id, redirectUri, codeVerifier: verifier, audience });
  await assert.rejects(exchangeAuthorizationCode({ code, clientId: client.client_id, redirectUri, codeVerifier: verifier, audience }), /invalid_grant/);
  assert.equal((await authenticateMcpAccessToken(first.access_token, audience))?.userId, user.id);
  assert.equal(await authenticateMcpAccessToken(first.access_token, "https://other.example/mcp"), null);

  const second = await rotateRefreshToken({ refreshToken: first.refresh_token, clientId: client.client_id, audience });
  await assert.rejects(rotateRefreshToken({ refreshToken: first.refresh_token, clientId: client.client_id, audience }), /invalid_grant/);
  const connection = await prisma.mcpConnection.findFirstOrThrow({ where: { userId: user.id } });
  await revokeConnection(connection.id, user.id);
  assert.equal(await authenticateMcpAccessToken(second.access_token, audience), null);
  await assert.rejects(rotateRefreshToken({ refreshToken: second.refresh_token, clientId: client.client_id, audience }), /invalid_grant/);
});
