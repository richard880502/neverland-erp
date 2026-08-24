import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../lib/prisma";
import { createBillingStatement, markBillingStatementPaid, previewBillingStatement, voidBillingStatement } from "../../lib/services/billing";

const email = "billing-integration@example.com";
const sku = "BILLING-INTEGRATION-SKU";
const channelName = "Billing Integration Consignment";

async function cleanup() {
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

test("billing auto-fills by date but manual billing remains independent from stock movements", async () => {
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

  assert.equal(await prisma.stockMovement.count({ where: { productId: product.id } }), 0);
  const emptyAutofill = await previewBillingStatement({ channelId: channel.id, periodStart: "2026-08-01", periodEnd: "2026-08-31" });
  assert.equal(emptyAutofill.sourceMovementCount, 0);
  assert.equal(emptyAutofill.items.length, 0);

  const input = {
    channelId: channel.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    issuedAt: "2026-08-24",
    settlementRate: 0.6,
    taxRate: 0.05,
    shippingFee: 100,
    note: "manual integration",
    items: [{ productId: product.id, quantity: 2 }],
  };
  const statement = await createBillingStatement(input, actor);
  assert.match(statement.statementNo, /^BL-202608-\d{3}$/);
  assert.equal(statement.companyName, "Billing Customer Ltd.");
  assert.equal(Number(statement.totalAmount), 1360);

  await prisma.channel.update({ where: { id: channel.id }, data: { companyName: "Changed Customer", settlementRate: 0.7 } });
  await prisma.product.update({ where: { id: product.id }, data: { name: "Changed Product Name" } });
  const snapshot = await prisma.billingStatement.findUniqueOrThrow({ where: { id: statement.id }, include: { items: true, sources: true } });
  assert.equal(snapshot.companyName, "Billing Customer Ltd.");
  assert.equal(Number(snapshot.settlementRate), 0.6);
  assert.equal(snapshot.items[0].productName, "Billing Tee");
  assert.equal(snapshot.sources.length, 0);

  await voidBillingStatement(statement.id, actor);
  const voided = await prisma.billingStatement.findUniqueOrThrow({ where: { id: statement.id } });
  assert.equal(voided.status, "VOID");

  const replacement = await createBillingStatement({ ...input, note: "replacement" }, actor);
  assert.notEqual(replacement.id, statement.id);
  assert.equal(Number(replacement.totalAmount), 1360);

  await markBillingStatementPaid(replacement.id, { paidAt: "2026-08-25", paidAmount: 1360, paymentMethod: "銀行轉帳", paymentReference: "12345" }, actor);
  const paid = await prisma.billingStatement.findUniqueOrThrow({ where: { id: replacement.id } });
  assert.equal(paid.status, "PAID");
  assert.equal(Number(paid.paidAmount), 1360);
  assert.equal(paid.paymentReference, "12345");
  await assert.rejects(voidBillingStatement(replacement.id, actor), /已收款請款單不可直接作廢/);

  await prisma.stockMovement.createMany({ data: [
    { occurredAt: new Date("2026-08-10T12:00:00+08:00"), type: "CONSIGN_SOLD", quantity: 1, productId: product.id, channelId: channel.id, createdById: user.id },
    { occurredAt: new Date("2026-08-20T12:00:00+08:00"), type: "CONSIGN_SOLD", quantity: 2, productId: product.id, channelId: channel.id, createdById: user.id },
    { occurredAt: new Date("2026-09-01T12:00:00+08:00"), type: "CONSIGN_SOLD", quantity: 4, productId: product.id, channelId: channel.id, createdById: user.id },
  ] });

  const augustAutofill = await previewBillingStatement({ channelId: channel.id, periodStart: "2026-08-01", periodEnd: "2026-08-31" });
  assert.equal(augustAutofill.sourceMovementCount, 2);
  assert.equal(augustAutofill.items.length, 1);
  assert.equal(augustAutofill.items[0].productId, product.id);
  assert.equal(augustAutofill.items[0].quantity, 3);

  const septemberAutofill = await previewBillingStatement({ channelId: channel.id, periodStart: "2026-09-01", periodEnd: "2026-09-30" });
  assert.equal(septemberAutofill.sourceMovementCount, 1);
  assert.equal(septemberAutofill.items[0].quantity, 4);
});
