import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../lib/prisma";
import { saveShipment, dispatchShipment, deleteShipmentDraft, updateShipmentFreight } from "../../lib/services/shipments";
import { createBillingStatement, previewBillingStatement, voidBillingStatement } from "../../lib/services/billing";
import { createInventoryMovement } from "../../lib/services/movements";

const email = "shipment-test@example.com";
const skuPrefix = "SHIPMENT-TEST-";
const dealerName = "Shipment Test Dealer";
const freightDealerName = "Shipment Freight Dealer";
async function cleanup() {
  const dealers = { name: { in: [dealerName, freightDealerName] } };
  const channelIds = (await prisma.channel.findMany({ where: dealers, select: { id: true } })).map((channel) => channel.id);
  await prisma.billingStatement.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.shippingGroup.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.financeTransaction.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.shipment.deleteMany({ where: { channel: dealers } });
  await prisma.googleSheetMovementQueue.deleteMany({ where: { movement: { product: { sku: { startsWith: skuPrefix } } } } });
  await prisma.stockMovement.deleteMany({ where: { product: { sku: { startsWith: skuPrefix } } } });
  await prisma.auditLog.deleteMany({ where: { user: { email } } });
  await prisma.product.deleteMany({ where: { sku: { startsWith: skuPrefix } } });
  await prisma.channel.deleteMany({ where: dealers });
  await prisma.user.deleteMany({ where: { email } });
}
test.before(cleanup);
test.after(async () => { await cleanup(); await prisma.$disconnect(); });
test("drafts do not change stock, dispatch is atomic and idempotent on a consignment dealer", async () => {
  const user = await prisma.user.create({ data: { email, name: "Shipment Test", passwordHash: "unused", role: "ADMIN" } });
  const actor = { userId: user.id, role: user.role };
  const channel = await prisma.channel.create({ data: { name: dealerName, type: "CONSIGNMENT", settlementRate: 0.6 } });
  const [a, b] = await Promise.all(["A", "B"].map((suffix) => prisma.product.create({ data: { sku: skuPrefix + suffix, name: "Test", size: suffix, listPrice: 1000 } })));
  await createInventoryMovement({ type: "RECEIVE", productId: a.id, quantity: 3 }, actor);
  await createInventoryMovement({ type: "RECEIVE", productId: b.id, quantity: 1 }, actor);
  const draft = await saveShipment({ channelId: channel.id, kind: "BUYOUT", lines: [{ productId: a.id, quantity: 2 }, { productId: b.id, quantity: 2 }] }, actor);
  assert.equal(Number(draft.lines[0].tradePrice), 500);
  assert.equal(await prisma.stockMovement.count({ where: { referenceNo: draft.id } }), 0);
  await assert.rejects(dispatchShipment(draft.id, actor), /庫存不足/);
  assert.equal(await prisma.stockMovement.count({ where: { referenceNo: draft.id } }), 0);
  assert.equal((await prisma.shipment.findUniqueOrThrow({ where: { id: draft.id } })).status, "DRAFT");
  await createInventoryMovement({ type: "RECEIVE", productId: b.id, quantity: 2 }, actor);
  await Promise.all([dispatchShipment(draft.id, actor), dispatchShipment(draft.id, actor)]);
  const movements = await prisma.stockMovement.findMany({ where: { referenceNo: draft.id } });
  assert.equal(movements.length, 2);
  assert.ok(movements.every((m) => m.type === "BUYOUT" && Number(m.unitPrice) === 500));
  assert.equal((await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } })).type, "CONSIGNMENT");
  await prisma.product.update({ where: { id: a.id }, data: { listPrice: 2000 } });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const buyout = await previewBillingStatement({ channelId: channel.id, sourceType: "BUYOUT", periodStart: today, periodEnd: today });
  assert.equal(buyout.sourceMovementCount, 2);
  assert.equal(buyout.items.find((item) => item.productId === a.id)?.settlementPrice, 500);
  assert.equal(buyout.items.find((item) => item.productId === a.id)?.listPrice, 1000);
  const consignment = await previewBillingStatement({ channelId: channel.id, periodStart: today, periodEnd: today });
  assert.equal(consignment.sourceType, "CONSIGNMENT");
  assert.equal(consignment.sourceMovementCount, 0);
  const later = await saveShipment({ channelId: channel.id, kind: "CONSIGNMENT", lines: [{ productId: b.id, quantity: 1 }] }, actor);
  assert.equal(Number(later.lines[0].tradePrice), 600);
});

test("freight splits paid vs recoverable, can be filled in after dispatch, and is billed exactly once", async () => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const actor = { userId: user.id, role: user.role };
  const channel = await prisma.channel.create({ data: { name: freightDealerName, type: "CONSIGNMENT", settlementRate: 0.6, defaultShippingFee: 999, defaultShippingPayer: "REIMBURSABLE" } });
  const product = await prisma.product.create({ data: { sku: skuPrefix + "F", name: "Freight Tee", size: "M", listPrice: 1000 } });
  await createInventoryMovement({ type: "RECEIVE", productId: product.id, quantity: 10 }, actor);

  await assert.rejects(saveShipment({ channelId: channel.id, kind: "CONSIGNMENT", freightActual: 120, freightPaid: 120, freightRecoverable: 130, lines: [{ productId: product.id, quantity: 1 }] }, actor), /不可超過/);
  await assert.rejects(saveShipment({ channelId: channel.id, kind: "CONSIGNMENT", freightActual: 120, lines: [{ productId: product.id, quantity: 1 }] }, actor), /同時填寫/);

  // Partial split: Neverland pays 120, recovers 80, absorbs 40.
  const split = await saveShipment({ channelId: channel.id, kind: "CONSIGNMENT", shippingMethod: "黑貓宅急便", freightActual: 120, freightPaid: 120, freightRecoverable: 80, lines: [{ productId: product.id, quantity: 2 }] }, actor);
  await dispatchShipment(split.id, actor);
  const splitKey = `SHIPMENT:${split.id}`;
  const splitExpense = await prisma.financeTransaction.findMany({ where: { sourceRef: `MOVEMENT_SHIPPING:${splitKey}` } });
  assert.equal(splitExpense.length, 1);
  assert.equal(Number(splitExpense[0].amount), 120);
  const splitMovement = await prisma.stockMovement.findFirstOrThrow({ where: { referenceNo: split.id } });
  assert.equal(Number(splitMovement.shippingFee), 120);
  assert.equal(splitMovement.shippingPayer, "COMPANY");
  assert.equal(splitMovement.shippingMethod, "黑貓宅急便");

  // Pending freight must not fall back to the channel default (999 reimbursable).
  const pending = await saveShipment({ channelId: channel.id, kind: "CONSIGNMENT", lines: [{ productId: product.id, quantity: 1 }] }, actor);
  await dispatchShipment(pending.id, actor);
  const pendingKey = `SHIPMENT:${pending.id}`;
  assert.equal(await prisma.financeTransaction.count({ where: { sourceRef: `MOVEMENT_SHIPPING:${pendingKey}` } }), 0);
  const pendingMovement = await prisma.stockMovement.findFirstOrThrow({ where: { referenceNo: pending.id } });
  assert.equal(pendingMovement.shippingFee, null);
  await assert.rejects(updateShipmentFreight(pending.id, {}, actor), /完整運費/);
  await updateShipmentFreight(pending.id, { freightActual: 100, freightPaid: 100, freightRecoverable: 100 }, actor);
  assert.equal(Number((await prisma.financeTransaction.findFirstOrThrow({ where: { sourceRef: `MOVEMENT_SHIPPING:${pendingKey}` } })).amount), 100);
  // Correcting it again updates the same expense instead of adding one.
  await updateShipmentFreight(pending.id, { freightActual: 90, freightPaid: 90, freightRecoverable: 90 }, actor);
  const pendingExpenses = await prisma.financeTransaction.findMany({ where: { sourceRef: `MOVEMENT_SHIPPING:${pendingKey}` } });
  assert.equal(pendingExpenses.length, 1);
  assert.equal(Number(pendingExpenses[0].amount), 90);
  assert.equal(Number((await prisma.stockMovement.findFirstOrThrow({ where: { referenceNo: pending.id } })).shippingFee), 90);

  // Proxy shipment ("代寄") recorded directly as a movement with the same split rules.
  await createInventoryMovement({ type: "CONSIGN_OUT", productId: product.id, channelId: channel.id, quantity: 1, shippingActual: 60, shippingPaid: 60, shippingRecoverable: 30 }, actor);
  await assert.rejects(createInventoryMovement({ type: "CONSIGN_OUT", productId: product.id, channelId: channel.id, quantity: 1, shippingActual: 60, shippingPaid: 60, shippingRecoverable: 30, shippingFee: 60 }, actor), /不可與舊版/);

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const preview = await previewBillingStatement({ channelId: channel.id, periodStart: today, periodEnd: today });
  assert.equal(preview.recoverableFreightFee, 200);
  assert.equal(preview.recoverableFreightGroupCount, 3);
  assert.equal(preview.suggestedReimbursableShippingFee, 200);

  const billing = { channelId: channel.id, periodStart: today, periodEnd: today, issuedAt: today, settlementRate: 0.6, taxRate: 0, sourceMovementIds: [], items: [{ productId: product.id, quantity: 1 }] };
  const requested = { ...billing, shippingFee: 200, freightSnapshot: preview.freightSnapshot };
  await assert.rejects(createBillingStatement({ ...requested, shippingFee: 150 }, actor), /不可少於/);
  const statement = await createBillingStatement(requested, actor);
  assert.equal(await prisma.billingShippingClaim.count({ where: { statementId: statement.id } }), 3);
  const refreshed = await previewBillingStatement(billing);
  assert.equal(refreshed.recoverableFreightFee, 0);
  // A second browser tab still holding the old preview cannot charge the same freight as a manual fee.
  await assert.rejects(createBillingStatement(requested, actor), /代墊運費已變更或已列入請款/);
  await assert.rejects(createBillingStatement({ ...billing, shippingFee: 200 }, actor), /重新整理預覽/);
  assert.equal(await prisma.billingStatement.count({ where: { channelId: channel.id } }), 1);
  await assert.rejects(updateShipmentFreight(split.id, { freightActual: 120, freightPaid: 120, freightRecoverable: 50 }, actor), /已列入請款單/);

  await voidBillingStatement(statement.id, actor);
  assert.equal((await previewBillingStatement({ channelId: channel.id, periodStart: today, periodEnd: today })).recoverableFreightFee, 200);

  const draft = await saveShipment({ channelId: channel.id, kind: "CONSIGNMENT", lines: [{ productId: product.id, quantity: 1 }] }, actor);
  await deleteShipmentDraft(draft.id, actor);
  assert.equal(await prisma.shipment.count({ where: { id: draft.id } }), 0);
  await assert.rejects(deleteShipmentDraft(split.id, actor), /不可刪除/);
});
