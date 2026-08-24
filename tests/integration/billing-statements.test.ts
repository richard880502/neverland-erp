import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../lib/prisma";
import { createInventoryMovement } from "../../lib/services/movements";
import { createBillingStatement, markBillingStatementPaid, previewBillingStatement } from "../../lib/services/billing";

const email = "billing-integration@example.com";
const sku = "BILLING-INTEGRATION-SKU";
const channelName = "Billing Integration Consignment";

async function cleanup() {
  await prisma.billingStatement.deleteMany({ where: { channel: { name: channelName } } });
  await prisma.googleSheetMovementQueue.deleteMany({ where: { movement: { product: { sku } } } });
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

test("billing statement snapshots customer/item data and prevents duplicate billing", async () => {
  const user = await prisma.user.create({ data: { email, name: "Billing Integration", passwordHash: "unused", role: "ADMIN", mustChangePassword: false } });
  const product = await prisma.product.create({ data: { sku, name: "Billing Tee", size: "M", listPrice: 1000 } });
  const channel = await prisma.channel.create({ data: {
    name: channelName,
    type: "CONSIGNMENT",
    companyName: "Billing Customer Ltd.",
    taxId: "12345678",
    contactName: "Buyer",
    settlementRate: 0.6,
    taxRate: 0.05,
    paymentTermsDays: 10,
  } });
  const actor = { userId: user.id, role: user.role };
  await createInventoryMovement({ type: "RECEIVE", productId: product.id, quantity: 5 }, actor);
  await createInventoryMovement({ type: "CONSIGN_OUT", productId: product.id, channelId: channel.id, quantity: 3 }, actor);
  await createInventoryMovement({ type: "CONSIGN_SOLD", productId: product.id, channelId: channel.id, quantity: 2, unitPrice: 1000 }, actor);

  const input = { channelId: channel.id, periodStart: "2026-08-01", periodEnd: "2026-08-31", settlementRate: 0.6, taxRate: 0.05, shippingFee: 100 };
  const preview = await previewBillingStatement(input);
  assert.equal(preview.sourceMovementCount, 1);
  assert.equal(preview.items.length, 1);
  assert.equal(preview.items[0].settlementPrice, 600);
  assert.equal(preview.items[0].subtotal, 1200);
  assert.equal(preview.taxAmount, 60);
  assert.equal(preview.totalAmount, 1360);

  const statement = await createBillingStatement({ ...input, issuedAt: "2026-08-24", note: "integration" }, actor);
  assert.match(statement.statementNo, /^BL-202608-\d{3}$/);
  assert.equal(statement.companyName, "Billing Customer Ltd.");
  assert.equal(Number(statement.totalAmount), 1360);

  await prisma.channel.update({ where: { id: channel.id }, data: { companyName: "Changed Customer", settlementRate: 0.7 } });
  const snapshot = await prisma.billingStatement.findUniqueOrThrow({ where: { id: statement.id }, include: { items: true, sources: true } });
  assert.equal(snapshot.companyName, "Billing Customer Ltd.");
  assert.equal(Number(snapshot.settlementRate), 0.6);
  assert.equal(snapshot.items[0].productName, "Billing Tee");
  assert.equal(snapshot.sources.length, 1);

  const after = await previewBillingStatement(input);
  assert.equal(after.sourceMovementCount, 0);
  assert.equal(after.alreadyBilledCount, 1);
  await assert.rejects(createBillingStatement({ ...input, issuedAt: "2026-08-24", note: null }, actor), /已經請款/);

  await markBillingStatementPaid(statement.id, { paidAt: "2026-08-25", paidAmount: 1360, paymentMethod: "銀行轉帳", paymentReference: "12345" }, actor);
  const paid = await prisma.billingStatement.findUniqueOrThrow({ where: { id: statement.id } });
  assert.equal(paid.status, "PAID");
  assert.equal(Number(paid.paidAmount), 1360);
  assert.equal(paid.paymentReference, "12345");
});
