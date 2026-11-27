import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { getInventoryRows } from "../../lib/data";
import { sumInventory } from "../../lib/inventory";
import { prisma } from "../../lib/prisma";

test.after(() => prisma.$disconnect());

test("database inventory totals preserve signed reversals, location balances and products with no history", async () => {
  const prefix = `inventory-aggregation-${randomUUID()}`;
  try {
    const user = await prisma.user.create({ data: { email: `${prefix}@example.com`, name: prefix, passwordHash: "unused" } });
    const product = await prisma.product.create({ data: { name: prefix, sku: prefix, safetyStock: 2 } });
    const empty = await prisma.product.create({ data: { name: prefix, sku: `${prefix}-empty` } });
    const inactive = await prisma.product.create({ data: { name: prefix, sku: `${prefix}-inactive`, active: false } });
    const current = await prisma.channel.create({ data: { name: `${prefix}-current`, type: "CONSIGNMENT" } });
    const cleared = await prisma.channel.create({ data: { name: `${prefix}-cleared`, type: "CONSIGNMENT", active: false } });
    const zeroOnly = await prisma.channel.create({ data: { name: `${prefix}-zero`, type: "CONSIGNMENT" } });
    const date = new Date("2026-08-15T00:00:00Z");
    const movements: Array<Pick<Prisma.StockMovementCreateManyInput, "type" | "quantity" | "channelId">> = [
      { type: "RECEIVE", quantity: 20 },
      { type: "ADJUSTMENT", quantity: -2 },
      { type: "SHIP", quantity: 3, channelId: current.id },
      { type: "SALES_RETURN", quantity: 1, channelId: current.id },
      { type: "PURCHASE_RETURN", quantity: 1 },
      { type: "BUYOUT", quantity: 2 },
      { type: "DEFECT", quantity: 1 },
      { type: "CONSIGN_OUT", quantity: 5, channelId: current.id },
      { type: "CONSIGN_RETURN", quantity: 1, channelId: current.id },
      { type: "CONSIGN_SOLD", quantity: 1, channelId: current.id },
      { type: "CONSIGN_OUT", quantity: 0, channelId: zeroOnly.id },
    ];
    await prisma.stockMovement.createMany({
      data: movements.map((movement) => ({ ...movement, productId: product.id, createdById: user.id, occurredAt: date })),
    });
    const original = await prisma.stockMovement.create({
      data: { type: "CONSIGN_OUT", quantity: 4, productId: product.id, channelId: cleared.id, createdById: user.id, occurredAt: date, reversedAt: date },
    });
    await prisma.stockMovement.create({
      data: { type: original.type, quantity: -original.quantity, productId: product.id, channelId: cleared.id, createdById: user.id, occurredAt: date, reversalOfId: original.id },
    });
    await prisma.stockMovement.create({
      data: { type: "RECEIVE", quantity: 50, productId: inactive.id, createdById: user.id, occurredAt: date },
    });

    const rows = await getInventoryRows();
    const row = rows.find((item) => item.id === product.id);
    assert.ok(row);
    const oldTotals = sumInventory(await prisma.stockMovement.findMany({ where: { productId: product.id } }));
    assert.deepEqual({ warehouse: row.warehouse, consignment: row.consignment, sold: row.sold, defect: row.defect }, oldTotals);
    assert.equal(row.total, oldTotals.warehouse + oldTotals.consignment);
    assert.deepEqual(row.locations, [
      { id: current.id, name: current.name, type: current.type, quantity: 3 },
      { id: cleared.id, name: cleared.name, type: cleared.type, quantity: 0 },
    ]);
    const emptyRow = rows.find((item) => item.id === empty.id);
    assert.ok(emptyRow);
    assert.deepEqual([emptyRow.warehouse, emptyRow.status, emptyRow.locations], [0, "補貨注意", []]);
    assert.equal(rows.some((item) => item.id === inactive.id), false);
  } finally {
    await prisma.stockMovement.deleteMany({ where: { product: { sku: { startsWith: prefix } } } });
    await prisma.product.deleteMany({ where: { sku: { startsWith: prefix } } });
    await prisma.channel.deleteMany({ where: { name: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { email: `${prefix}@example.com` } });
  }
});
