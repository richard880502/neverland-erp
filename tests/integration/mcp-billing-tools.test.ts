import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../lib/prisma";
import type { McpAuth } from "../../lib/mcp/oauth";
import { callMcpTool } from "../../lib/mcp/registry";

const email = "mcp-billing-integration@example.com";
const sku = "MCP-BILLING-INTEGRATION-SKU";
const channelName = "MCP Billing Integration Consignment";

type McpResult<T> = {
  content: Array<{ type: string; text: string }>;
  structuredContent: T;
};

function auth(userId: string, role: McpAuth["role"], scopes: McpAuth["scopes"]): McpAuth {
  return {
    userId,
    role,
    scopes,
    connectionId: "mcp-billing-integration-connection",
    clientId: "mcp-billing-integration-client",
  };
}

async function cleanup() {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    await prisma.mcpPreparedAction.deleteMany({ where: { userId: user.id } });
    await prisma.auditLog.deleteMany({ where: { userId: user.id } });
  }
  await prisma.billingStatement.deleteMany({ where: { channel: { name: channelName } } });
  await prisma.stockMovement.deleteMany({ where: { product: { sku } } });
  await prisma.product.deleteMany({ where: { sku } });
  await prisma.channel.deleteMany({ where: { name: channelName } });
  await prisma.user.deleteMany({ where: { email } });
}

test.before(cleanup);
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("billing MCP previews, confirms, creates and voids with scope/role enforcement", async () => {
  const user = await prisma.user.create({
    data: {
      email,
      name: "MCP Billing Integration",
      passwordHash: "unused",
      role: "STAFF",
      mustChangePassword: false,
    },
  });
  const product = await prisma.product.create({
    data: { sku, name: "MCP Billing Tee", size: "M", listPrice: 1000 },
  });
  const channel = await prisma.channel.create({
    data: {
      name: channelName,
      type: "CONSIGNMENT",
      companyName: "MCP Billing Customer Ltd.",
      taxId: "87654321",
      settlementRate: 0.6,
      taxRate: 0.05,
      paymentTermsDays: 10,
    },
  });
  await prisma.stockMovement.create({
    data: {
      occurredAt: new Date("2026-08-12T12:00:00+08:00"),
      type: "CONSIGN_SOLD",
      quantity: 2,
      productId: product.id,
      channelId: channel.id,
      createdById: user.id,
    },
  });

  const readAuth = auth(user.id, "STAFF", ["billing:read"]);
  const writeAuth = auth(user.id, "STAFF", ["billing:write"]);

  const previewResult = await callMcpTool("preview_billing_statement", {
    channelId: channel.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    shippingFee: 100,
  }, readAuth) as McpResult<{
    sourceMovementCount: number;
    items: Array<{ sku: string; quantity: number; settlementPrice: number; subtotal: number }>;
    totals: { subtotal: number; taxAmount: number; shippingFee: number; totalAmount: number };
  }>;
  assert.equal(previewResult.structuredContent.sourceMovementCount, 1);
  assert.equal(previewResult.structuredContent.items[0].sku, sku);
  assert.equal(previewResult.structuredContent.items[0].quantity, 2);
  assert.equal(previewResult.structuredContent.items[0].settlementPrice, 600);
  assert.deepEqual(previewResult.structuredContent.totals, {
    subtotal: 1200,
    taxAmount: 60,
    shippingFee: 100,
    totalAmount: 1360,
  });

  const createArgs = {
    channelId: channel.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    issuedAt: "2026-08-26",
    settlementRate: 0.6,
    taxRate: 0.05,
    shippingFee: 100,
    note: "created through MCP",
    items: [{ sku, quantity: 2 }],
  };

  const prepared = await callMcpTool("create_billing_statement", createArgs, writeAuth) as McpResult<{
    requiresConfirmation: boolean;
    confirmationToken: string;
    preview: { totals: { totalAmount: number } };
  }>;
  assert.equal(prepared.structuredContent.requiresConfirmation, true);
  assert.equal(prepared.structuredContent.preview.totals.totalAmount, 1360);
  assert.equal(await prisma.billingStatement.count({ where: { channelId: channel.id } }), 0);

  const committed = await callMcpTool("create_billing_statement", {
    ...createArgs,
    confirmationToken: prepared.structuredContent.confirmationToken,
  }, writeAuth) as McpResult<{
    committed: boolean;
    statement: { id: string; statementNo: string; totalAmount: number; status: string };
  }>;
  assert.equal(committed.structuredContent.committed, true);
  assert.match(committed.structuredContent.statement.statementNo, /^BL-202608-\d{3}$/);
  assert.equal(committed.structuredContent.statement.totalAmount, 1360);
  assert.equal(committed.structuredContent.statement.status, "ISSUED");

  const stored = await prisma.billingStatement.findUniqueOrThrow({
    where: { id: committed.structuredContent.statement.id },
    include: { items: true },
  });
  assert.equal(Number(stored.totalAmount), 1360);
  assert.equal(stored.items[0].sku, sku);
  assert.equal(stored.items[0].quantity, 2);

  const createAudit = await prisma.auditLog.findFirst({
    where: {
      userId: user.id,
      action: "MCP_BILLING_STATEMENT_CREATED",
      entityId: stored.id,
    },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(createAudit);
  assert.deepEqual(createAudit.metadata, {
    source: "MCP",
    connectionId: writeAuth.connectionId,
    clientId: writeAuth.clientId,
    statementNo: stored.statementNo,
    totalAmount: 1360,
  });

  await assert.rejects(
    callMcpTool("create_billing_statement", {
      ...createArgs,
      confirmationToken: prepared.structuredContent.confirmationToken,
    }, writeAuth),
    /confirmationToken/,
  );

  await assert.rejects(
    callMcpTool("create_billing_statement", createArgs, auth(user.id, "VIEWER", ["billing:write"])),
    /角色權限不足/,
  );
  await assert.rejects(
    callMcpTool("create_billing_statement", createArgs, readAuth),
    /scope 不足/,
  );

  const voidPrepared = await callMcpTool("void_billing_statement", {
    statement: stored.statementNo,
  }, writeAuth) as McpResult<{ requiresConfirmation: boolean; confirmationToken: string }>;
  assert.equal(voidPrepared.structuredContent.requiresConfirmation, true);
  assert.equal((await prisma.billingStatement.findUniqueOrThrow({ where: { id: stored.id } })).status, "ISSUED");

  const voided = await callMcpTool("void_billing_statement", {
    statement: stored.statementNo,
    confirmationToken: voidPrepared.structuredContent.confirmationToken,
  }, writeAuth) as McpResult<{ committed: boolean; statement: { status: string } }>;
  assert.equal(voided.structuredContent.committed, true);
  assert.equal(voided.structuredContent.statement.status, "VOID");
  assert.equal((await prisma.billingStatement.findUniqueOrThrow({ where: { id: stored.id } })).status, "VOID");

  const voidAudit = await prisma.auditLog.findFirst({
    where: { userId: user.id, action: "MCP_BILLING_STATEMENT_VOIDED", entityId: stored.id },
  });
  assert.ok(voidAudit);
});
