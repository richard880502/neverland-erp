import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { listMcpTools } from "../lib/mcp/registry";
import type { McpAuth } from "../lib/mcp/oauth";
import {
  consignmentDirectFulfillmentSchema,
  movementInputSchema,
  movementTypeSchema,
} from "../lib/services/movements";
import { financeCreateSchema, financeItemSchema } from "../lib/services/finance";

/**
 * API ↔ MCP parity gate:
 *
 * The browser POST endpoints parse movementInputSchema / financeCreateSchema
 * and invoke the same ERP services. This test makes the *API Zod contract* the
 * source of truth. Adding a field to an API schema without updating MCP must
 * fail CI, not silently drop the new field during Zod parsing.
 *
 * Explicit exceptions are reviewed here: the API accepts productId, while
 * MCP uses sku; finance's system-owned provenance fields cannot be supplied
 * by a remote assistant.
 */
const auth: McpAuth = {
  userId: "contract-only",
  role: "ADMIN",
  scopes: ["inventory:write", "movements:read", "finance:write"],
  connectionId: "contract-only",
  clientId: "contract-only",
};
const definitions = listMcpTools(auth);
type Property = { type?: string; enum?: string[]; minimum?: number; maximum?: number; items?: { properties?: Record<string, unknown> } };
const get = (name: string) => {
  const definition = definitions.find((tool) => tool.name === name);
  assert.ok(definition, `MCP tool missing: ${name}`);
  return definition;
};
const props = (name: string) => {
  const properties = get(name).inputSchema.properties;
  assert.ok(properties, `MCP properties missing: ${name}`);
  return properties as Record<string, Property>;
};
const sorted = (values: string[]) => [...values].sort();

test("browser/API entrypoints still validate against the shared source-of-truth schemas", () => {
  const routes = [
    { path: "app/api/movements/route.ts", schema: "movementInputSchema", service: "createInventoryMovement" },
    { path: "app/api/finance/transactions/route.ts", schema: "financeCreateSchema", service: "createFinanceTransaction" },
  ];
  for (const route of routes) {
    const contents = readFileSync(join(process.cwd(), route.path), "utf8");
    assert.match(contents, new RegExp(`\\b${route.schema}\\.safeParse\\(`),
      `${route.path} no longer validates with ${route.schema}; update parity tests if the HTTP contract changes`);
    assert.match(contents, new RegExp(`\\b${route.service}\\(`),
      `${route.path} no longer delegates to ${route.service}; verify MCP/API execution parity`);
  }
});

test("general inventory MCP exposes every browser/API movement field (productId maps to sku)", () => {
  const apiKeys = Object.keys(movementInputSchema.shape)
    .map((key) => key === "productId" ? "sku" : key);
  const mcpKeys = Object.keys(props("create_inventory_movement"))
    .filter((key) => !["confirmationToken", "occurredOn"].includes(key));
  assert.deepEqual(sorted(mcpKeys), sorted(apiKeys),
    "Inventory API fields changed: update the MCP published schema and implementation rather than silently dropping input");
  const requiredApi = Object.entries(movementInputSchema.shape)
    .filter(([, schema]) => !schema.safeParse(undefined).success)
    .map(([key]) => key === "productId" ? "sku" : key);
  assert.deepEqual(sorted(get("create_inventory_movement").inputSchema.required ?? []), sorted(requiredApi));
  assert.deepEqual(props("create_inventory_movement").type.enum, [...movementTypeSchema.options]);
});

test("batch and specialized returns track the same API shipping fields and constraints", () => {
  const apiShippingKeys = Object.keys(movementInputSchema.shape).filter((key) => key.startsWith("shipping"));
  for (const name of ["create_inventory_movement", "create_inventory_movements_batch", "create_sales_return", "create_purchase_return"]) {
    const published = props(name);
    const mcpShippingKeys = Object.keys(published).filter((key) => key.startsWith("shipping"));
    assert.deepEqual(sorted(mcpShippingKeys), sorted(apiShippingKeys),
      `${name} is missing a shipping field supported by the browser/API`);
    assert.equal(published.shippingFee.type, "number");
    assert.equal(published.shippingFee.minimum, 0);
    assert.equal(published.shippingFee.maximum, 1_000_000);
    assert.equal(published.shippingMethod.type, "string");
  }

  // The API accepts the empty string for an unset HTML form field, but
  // MCP must advertise all actual payer choices.
  const payerUnion = movementInputSchema.shape.shippingPayer.unwrap();
  const apiPayers = (payerUnion.options[1] as { options: readonly string[] }).options;
  assert.deepEqual(props("create_inventory_movement").shippingPayer.enum, [...apiPayers]);

  const batch = props("create_inventory_movements_batch");
  assert.ok(batch.items.items?.properties?.sku);
  assert.ok(batch.items.items?.properties?.quantity);
  assert.ok(batch.confirmationToken, "batch writes must retain two-phase approval");
  assert.ok(props("create_inventory_movement").confirmationToken);
});

test("consignment direct-fulfillment MCP tracks its dedicated API/domain schema", () => {
  const api = Object.keys(consignmentDirectFulfillmentSchema.shape)
    .map((key) => key === "productId" ? "sku" : key);
  const mcp = Object.keys(props("create_consignment_direct_fulfillment"))
    .filter((key) => !["confirmationToken", "occurredOn"].includes(key));
  assert.deepEqual(sorted(mcp), sorted(api),
    "Consignment fulfillment domain schema changed; MCP fulfillment needs explicit alignment");
});

test("finance MCP mirrors every writable API field except explicitly restricted provenance", () => {
  const restricted = ["source", "sourceRef", "legacySheet", "legacyRow"];
  const apiKeys = Object.keys(financeCreateSchema.shape);
  const expected = apiKeys.filter((key) => !restricted.includes(key));
  const exposed = Object.keys(props("create_finance_transaction"))
    .filter((key) => key !== "confirmationToken");
  assert.deepEqual(sorted(exposed), sorted(expected),
    "Finance API contract changed; update MCP schema + runtime parser or document a deliberate security exception");
  for (const field of restricted) {
    assert.ok(apiKeys.includes(field), `Review exception: API provenance field '${field}' was removed`);
    assert.ok(!exposed.includes(field), `MCP must not expose system-owned provenance '${field}'`);
  }
  const required = Object.entries(financeCreateSchema.shape)
    .filter(([, schema]) => !schema.safeParse(undefined).success)
    .map(([key]) => key);
  assert.deepEqual(sorted(get("create_finance_transaction").inputSchema.required ?? []), sorted(required));

  // Compare enum options dynamically: introducing a new API status must also
  // update MCP discovery, otherwise the assistant cannot send that status.
  const enumFields = ["direction", "paymentStatus", "reconciliationStatus", "invoiceStatus"] as const;
  for (const field of enumFields) {
    const definition = financeCreateSchema.shape[field] as unknown as {
      options?: readonly string[];
      def?: { innerType?: { options?: readonly string[] } };
    };
    const apiChoices = definition.options ?? definition.def?.innerType?.options;
    assert.ok(apiChoices, `Cannot inspect API enum ${field}`);
    assert.deepEqual(props("create_finance_transaction")[field].enum, [...apiChoices],
      `Finance API status values changed for '${field}' but MCP discovery is stale`);
  }

  const financeItems = props("create_finance_transaction").items.items?.properties;
  assert.ok(financeItems);
  assert.deepEqual(sorted(Object.keys(financeItems)), sorted(Object.keys(financeItemSchema.shape)),
    "Finance item model changed; MCP must expose its new writable item fields");
  // Critical numeric bounds are part of the contract, not only property names.
  const itemFields = financeItems as Record<string, Property>;
  assert.equal(itemFields.quantity.minimum, 1);
  assert.equal(itemFields.quantity.maximum, 1_000_000);
  for (const name of ["unitAmount", "lineAmount"]) {
    assert.equal(itemFields[name].minimum, 0);
    assert.equal(itemFields[name].maximum, 100_000_000);
  }

  const invoiceZod = financeCreateSchema.shape.invoice.unwrap().unwrap();
  const invoiceMcp = props("create_finance_transaction").invoice as unknown as { properties?: Record<string, unknown> };
  assert.ok(invoiceMcp.properties);
  assert.deepEqual(sorted(Object.keys(invoiceMcp.properties)), sorted(Object.keys(invoiceZod.shape)),
    "Invoice API model changed; MCP invoice contract is stale");
  for (const field of ["grossAmount", "netAmount", "taxAmount"]) {
    const fieldSchema = invoiceMcp.properties[field] as Property;
    assert.equal(fieldSchema.minimum, 0);
    assert.equal(fieldSchema.maximum, 100_000_000);
  }
  assert.ok(props("create_finance_transaction").confirmationToken);
});

test("all MCP parity write tools stay gated by explicit high-risk scopes + confirmation", () => {
  for (const name of ["create_inventory_movement", "create_inventory_movements_batch", "create_sales_return", "create_purchase_return", "create_consignment_direct_fulfillment", "create_finance_transaction"]) {
    const tool = get(name);
    assert.equal(tool.annotations.readOnlyHint, false);
    assert.equal(tool.annotations.idempotentHint, false);
    assert.ok(tool.inputSchema.properties?.confirmationToken, `${name} missing confirmationToken`);
  }
});
