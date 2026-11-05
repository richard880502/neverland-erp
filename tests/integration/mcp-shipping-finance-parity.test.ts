import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { callMcpTool } from "../../lib/mcp/registry";
import { createInventoryMovement } from "../../lib/services/movements";
import type { McpAuth } from "../../lib/mcp/oauth";

const suffix = "mcp-parity-" + randomUUID().slice(0, 8);
const email = suffix + "@example.com";
const sku1 = suffix + "-A";
const sku2 = suffix + "-B";
const channelName = suffix + "-channel";
const clientId = suffix + "-client";
let userId = "";
let channelId = "";
let createdShippingCategory = false;

async function cleanup() {
  if (userId) {
    await prisma.financeTransaction.deleteMany({ where: { createdById: userId } });
    await prisma.googleSheetMovementQueue.deleteMany({ where: { movement: { createdById: userId } } });
    await prisma.stockMovement.deleteMany({ where: { createdById: userId } });
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.mcpPreparedAction.deleteMany({ where: { userId } });
    await prisma.mcpConnection.deleteMany({ where: { userId } });
    await prisma.product.deleteMany({ where: { sku: { in: [sku1, sku2] } } });
    await prisma.channel.deleteMany({ where: { id: channelId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  if (createdShippingCategory) await prisma.financeCategory.deleteMany({ where: { code: "shipping" } });
}

test.after(async () => { await cleanup(); await prisma.$disconnect(); });

test("MCP batch uses one expense for multiple SKUs, rejects changed defaults, and rolls back invalid batches", async () => {
  const user = await prisma.user.create({ data: { email, name: suffix, passwordHash: "unused", role: "STAFF", mustChangePassword: false } });
  userId = user.id;
  const channel = await prisma.channel.create({ data: { name: channelName, type: "DIRECT", defaultShippingMethod: "郵局", defaultShippingFee: 50, defaultShippingPayer: "COMPANY" } });
  channelId = channel.id;
  const category = await prisma.financeCategory.findUnique({ where: { code: "shipping" } });
  if (!category) {
    await prisma.financeCategory.create({ data: { id: randomUUID(), code: "shipping", name: "物流費", direction: "EXPENSE" } });
    createdShippingCategory = true;
  }
  const [a, b] = await Promise.all([
    prisma.product.create({ data: { sku: sku1, name: "Parity A" } }),
    prisma.product.create({ data: { sku: sku2, name: "Parity B" } }),
  ]);
  const actor = { userId, role: "STAFF" } as const;
  await createInventoryMovement({ productId: a.id, type: "RECEIVE", quantity: 5 }, actor);
  await createInventoryMovement({ productId: b.id, type: "RECEIVE", quantity: 5 }, actor);
  const conn = await prisma.mcpConnection.create({ data: { userId, clientId, clientName: suffix, scopes: ["inventory:write", "movements:read", "finance:read", "finance:write"] } });
  const auth: McpAuth = { userId, role: "STAFF", scopes: ["inventory:write", "movements:read", "finance:read", "finance:write"], clientId, connectionId: conn.id };
  const command = {
    type: "SHIP",
    channelId,
    occurredOn: "2042-05-02",
    items: [{ sku: sku1, quantity: 2, unitPrice: 120 }, { sku: sku2, quantity: 3, unitPrice: 140 }],
    shippingMethod: "郵局", shippingFee: 70, shippingPayer: "COMPANY",
    referenceNo: suffix,
  };
  const prepared = await callMcpTool("create_inventory_movements_batch", command, auth);
  const preview = prepared.structuredContent as { confirmationToken: string; preview: { expenseCount: number; shipping: { expenseAmount: number }; items: unknown[] } };
  assert.equal(preview.preview.expenseCount, 1);
  assert.equal(preview.preview.shipping.expenseAmount, 70);
  assert.equal(preview.preview.items.length, 2);
  assert.equal(await prisma.financeTransaction.count({ where: { createdById: userId } }), 0);
  const commit = await callMcpTool("create_inventory_movements_batch", { ...command, confirmationToken: preview.confirmationToken }, auth);
  const result = commit.structuredContent as { committed: boolean; shippingGroupKey: string; movements: Array<{ id: string }> };
  assert.equal(result.committed, true);
  assert.equal(result.movements.length, 2);
  const stored = await prisma.stockMovement.findMany({ where: { id: { in: result.movements.map((m) => m.id) } } });
  assert.equal(stored.length, 2);
  assert.ok(stored.every((row) => row.shippingGroupKey === result.shippingGroupKey));
  assert.ok(stored.every((row) => Number(row.shippingFee) === 70 && row.shippingMethod === "郵局"));
  assert.ok(stored.every((row) => row.occurredAt.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }) === "2042-05-02"));
  const expenses = await prisma.financeTransaction.findMany({ where: { sourceRef: `MOVEMENT_SHIPPING:${result.shippingGroupKey}` } });
  assert.equal(expenses.length, 1);
  assert.equal(Number(expenses[0].amount), 70);

  const beforeCount = await prisma.stockMovement.count({ where: { createdById: userId } });
  const invalid = { ...command, items: [{ sku: sku1, quantity: 1, unitPrice: 120 }, { sku: sku2, quantity: 99, unitPrice: 140 }] };
  const invalidPreview = await callMcpTool("create_inventory_movements_batch", invalid, auth);
  const invalidToken = (invalidPreview.structuredContent as { confirmationToken: string }).confirmationToken;
  await assert.rejects(callMcpTool("create_inventory_movements_batch", { ...invalid, confirmationToken: invalidToken }, auth), /庫存不足/);
  assert.equal(await prisma.stockMovement.count({ where: { createdById: userId } }), beforeCount);
  assert.equal(await prisma.financeTransaction.count({ where: { createdById: userId } }), 1);

  const withDefaults = { sku: sku1, type: "SHIP", quantity: 1, unitPrice: 120, channelId, occurredOn: "2042-05-03" };
  const defaultsPreview = await callMcpTool("create_inventory_movement", withDefaults, auth);
  const defaultsToken = (defaultsPreview.structuredContent as { confirmationToken: string; preview: { shipping: { fee: number } } }).confirmationToken;
  await prisma.channel.update({ where: { id: channelId }, data: { defaultShippingFee: 90 } });
  await assert.rejects(callMcpTool("create_inventory_movement", { ...withDefaults, confirmationToken: defaultsToken }, auth), /confirmationToken/);
});

test("finance write requires explicit scope and confirmation, matching ERP finance domain", async () => {
  const connection = await prisma.mcpConnection.findFirstOrThrow({ where: { userId } });
  const auth: McpAuth = { userId, role: "STAFF", clientId, connectionId: connection.id, scopes: ["finance:write"] };
  const input = { occurredAt: "2042-05-02", direction: "EXPENSE", amount: 23, counterparty: "測試費用", summary: "MCP parity test" };
  const prepared = await callMcpTool("create_finance_transaction", input, auth);
  const token = (prepared.structuredContent as { confirmationToken: string }).confirmationToken;
  assert.ok(token);
  const result = await callMcpTool("create_finance_transaction", { ...input, confirmationToken: token }, auth);
  const id = (result.structuredContent as { transaction: { id: string } }).transaction.id;
  const record = await prisma.financeTransaction.findUniqueOrThrow({ where: { id } });
  assert.equal(record.direction, "EXPENSE");
  assert.equal(Number(record.amount), 23);
  await assert.rejects(callMcpTool("create_finance_transaction", { ...input, confirmationToken: token }, auth), /confirmationToken/);
  await assert.rejects(callMcpTool("create_finance_transaction", input, { ...auth, role: "VIEWER" }), /角色權限不足/);
  await assert.rejects(callMcpTool("create_finance_transaction", input, { ...auth, scopes: ["finance:read"] }), /scope 不足/);
  await assert.rejects(callMcpTool("create_finance_transaction", { ...input, source: "OTHER", sourceRef: "MOVEMENT_SHIPPING:fake" }, auth), /MANUAL/);
});
