import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../lib/prisma";
import { sumInventory } from "../../lib/inventory";
import { callMcpTool } from "../../lib/mcp/tools";
import type { McpAuth } from "../../lib/mcp/oauth";
import { createInventoryMovement, reverseInventoryMovement } from "../../lib/services/movements";
import { reversalEventWhere } from "../../lib/movement-events";

const email = "mcp-returns-integration@example.com";
const sku = "MCP-RETURNS-SKU";
const directName = "MCP Returns Direct";
const otherDirectName = "MCP Returns Other Direct";
const consignmentName = "MCP Returns Consignment";
const clientId = "returns-integration";
const occurredAt = new Date("2040-01-15T12:00:00.000Z");
const salesDay = "2040-01-15";
const reversalEmail = "mcp-reversal-integration@example.com";
const reversalSku = "MCP-REVERSAL-SKU";
const reversalClientId = "reversal-integration";

async function cleanup() {
  await prisma.googleSheetMovementQueue.deleteMany({ where: { movement: { product: { sku } } } });
  await prisma.stockMovement.deleteMany({ where: { product: { sku } } });
  await prisma.product.deleteMany({ where: { sku } });
  await prisma.googleSheetMovementQueue.deleteMany({ where: { movement: { product: { sku: reversalSku } } } });
  await prisma.stockMovement.deleteMany({ where: { product: { sku: reversalSku } } });
  await prisma.product.deleteMany({ where: { sku: reversalSku } });
  await prisma.channel.deleteMany({ where: { name: { in: [directName, otherDirectName, consignmentName] } } });
  await prisma.mcpPreparedAction.deleteMany({ where: { clientId } });
  await prisma.mcpConnection.deleteMany({ where: { clientId } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.mcpPreparedAction.deleteMany({ where: { clientId: reversalClientId } });
  await prisma.mcpConnection.deleteMany({ where: { clientId: reversalClientId } });
  await prisma.user.deleteMany({ where: { email: reversalEmail } });
}

async function commitTool(name: string, command: Record<string, unknown>, auth: McpAuth) {
  const prepared = await callMcpTool(name, command, auth);
  const preview = prepared.structuredContent as { requiresConfirmation: boolean; confirmationToken: string };
  assert.equal(preview.requiresConfirmation, true);
  assert.ok(preview.confirmationToken);
  return callMcpTool(name, { ...command, confirmationToken: preview.confirmationToken }, auth);
}

test.before(cleanup);
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("MCP returns and consignment direct fulfillment preserve inventory and net sales", async () => {
  const user = await prisma.user.create({ data: { email, name: "MCP Returns Integration", passwordHash: "unused", role: "ADMIN", mustChangePassword: false } });
  const connection = await prisma.mcpConnection.create({ data: { userId: user.id, clientId, clientName: "Returns integration", scopes: ["inventory:write", "sales:read"] } });
  const auth: McpAuth = { userId: user.id, role: user.role, scopes: ["inventory:write", "sales:read"], connectionId: connection.id, clientId };
  const [product, direct, otherDirect, consignment] = await Promise.all([
    prisma.product.create({ data: { sku, name: "MCP Returns Product" } }),
    prisma.channel.create({ data: { name: directName, type: "DIRECT" } }),
    prisma.channel.create({ data: { name: otherDirectName, type: "DIRECT" } }),
    prisma.channel.create({ data: { name: consignmentName, type: "CONSIGNMENT" } }),
  ]);
  const actor = { userId: user.id, role: user.role };

  await createInventoryMovement({ type: "RECEIVE", productId: product.id, quantity: 10, occurredAt }, actor);
  await createInventoryMovement({ type: "SHIP", productId: product.id, channelId: direct.id, quantity: 3, unitPrice: 100, occurredAt }, actor);
  await createInventoryMovement({ type: "CONSIGN_OUT", productId: product.id, channelId: consignment.id, quantity: 4, occurredAt }, actor);

  const wrongChannelCommand = { sku, quantity: 1, channelId: otherDirect.id, unitPrice: 100, occurredAt };
  const wrongPrepared = await callMcpTool("create_sales_return", wrongChannelCommand, auth);
  const wrongToken = (wrongPrepared.structuredContent as { confirmationToken: string }).confirmationToken;
  await assert.rejects(
    callMcpTool("create_sales_return", { ...wrongChannelCommand, confirmationToken: wrongToken }, auth),
    /可退回的已售數量不足/,
  );

  const salesReturn = await commitTool("create_sales_return", { sku, quantity: 1, channelId: direct.id, unitPrice: 100, referenceNo: "RETURN-1", occurredAt }, auth);
  assert.equal((salesReturn.structuredContent as { committed: boolean }).committed, true);

  const purchaseReturn = await commitTool("create_purchase_return", { sku, quantity: 2, referenceNo: "SUPPLIER-RETURN-1", occurredAt }, auth);
  assert.equal((purchaseReturn.structuredContent as { committed: boolean }).committed, true);

  const fulfillment = await commitTool("create_consignment_direct_fulfillment", {
    sku,
    sourceChannelId: consignment.id,
    salesChannelId: direct.id,
    quantity: 2,
    unitPrice: 200,
    referenceNo: "DIRECT-FULFILL-1",
    occurredAt,
  }, auth);
  const fulfillmentResult = fulfillment.structuredContent as { committed: boolean; sourceMovement: { type: string }; salesMovement: { type: string } };
  assert.equal(fulfillmentResult.committed, true);
  assert.equal(fulfillmentResult.sourceMovement.type, "CONSIGN_RETURN");
  assert.equal(fulfillmentResult.salesMovement.type, "SHIP");

  const movements = await prisma.stockMovement.findMany({ where: { productId: product.id } });
  const totals = sumInventory(movements);
  assert.deepEqual(totals, { warehouse: 2, consignment: 2, sold: 4, defect: 0 });

  const atConsignment = movements
    .filter((movement) => movement.channelId === consignment.id)
    .reduce((sum, movement) => sum + (movement.type === "CONSIGN_OUT" ? movement.quantity : movement.type === "CONSIGN_RETURN" || movement.type === "CONSIGN_SOLD" ? -movement.quantity : 0), 0);
  assert.equal(atConsignment, 2);

  const sales = await callMcpTool("get_sales_summary", { from: salesDay, to: salesDay }, auth);
  assert.deepEqual(sales.structuredContent, { transactions: 2, returnTransactions: 1, quantity: 4, revenue: 600 });
});

test("formal reversals are linked, net to zero, and list as one event", async () => {
  const user = await prisma.user.create({ data: { email: reversalEmail, name: "MCP Reversal Integration", passwordHash: "unused", role: "ADMIN", mustChangePassword: false } });
  const connection = await prisma.mcpConnection.create({ data: { userId: user.id, clientId: reversalClientId, clientName: "Reversal integration", scopes: ["movements:reverse"] } });
  const product = await prisma.product.create({ data: { sku: reversalSku, name: "MCP Reversal Product" } });
  const actor = { userId: user.id, role: user.role } as const;
  await createInventoryMovement({ type: "RECEIVE", productId: product.id, quantity: 5, occurredAt }, actor);
  const original = await createInventoryMovement({ type: "ADJUSTMENT", productId: product.id, quantity: 2, referenceNo: "REVERSAL-1", occurredAt }, actor);

  const auth: McpAuth = { userId: user.id, role: user.role, scopes: ["movements:reverse"], connectionId: connection.id, clientId: reversalClientId };
  const preview = await callMcpTool("reverse_inventory_movement", { movementId: original.id }, auth);
  const confirmationToken = (preview.structuredContent as { requiresConfirmation: boolean; confirmationToken: string }).confirmationToken;
  assert.ok(confirmationToken);
  const committed = await callMcpTool("reverse_inventory_movement", { movementId: original.id, confirmationToken }, auth);
  const result = committed.structuredContent as { committed: boolean; reversedMovementId: string; reversalMovementId: string };
  assert.equal(result.committed, true);
  assert.equal(result.reversedMovementId, original.id);

  const persisted = await prisma.stockMovement.findUniqueOrThrow({ where: { id: original.id }, include: { reversal: true } });
  assert.ok(persisted.reversedAt);
  assert.equal(persisted.reversal?.id, result.reversalMovementId);
  assert.equal(persisted.reversal?.reversalOfId, original.id);
  assert.equal(persisted.reversal?.quantity, -2);
  const allMovements = await prisma.stockMovement.findMany({ where: { productId: product.id } });
  assert.deepEqual(sumInventory(allMovements), { warehouse: 5, consignment: 0, sold: 0, defect: 0 });

  const groupedRows = await prisma.stockMovement.findMany({
    where: reversalEventWhere({ note: { contains: "沖銷：" } }),
    include: { reversal: true },
  });
  assert.deepEqual(groupedRows.map((movement) => movement.id), [original.id]);
  assert.equal(groupedRows[0].reversal?.id, result.reversalMovementId);
  await assert.rejects(callMcpTool("reverse_inventory_movement", { movementId: original.id }, auth), /找不到可沖銷的異動/);

  // The browser button calls this same service; direct calls must preserve the
  // exact link and accounting behaviour used by MCP confirmation.
  const directOriginal = await createInventoryMovement({ type: "ADJUSTMENT", productId: product.id, quantity: 1, occurredAt }, actor);
  const directReversal = await reverseInventoryMovement(directOriginal.id, actor);
  assert.equal(directReversal.reversalOfId, directOriginal.id);
});
