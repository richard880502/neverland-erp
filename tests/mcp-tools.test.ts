import assert from "node:assert/strict";
import test from "node:test";
import type { McpAuth } from "../lib/mcp/oauth";
import { callMcpTool, listMcpTools } from "../lib/mcp/tools";

function auth(role: McpAuth["role"], scopes: McpAuth["scopes"]): McpAuth {
  return { userId: "user", role, scopes, connectionId: "connection", clientId: "client" };
}

test("viewer discovery exposes only authorized read tools", () => {
  const names = listMcpTools(auth("VIEWER", ["inventory:read", "inventory:write"])).map((tool) => tool.name);
  assert.deepEqual(names, ["get_inventory", "get_inventory_by_channel", "get_low_stock"]);
});

test("staff discovery intersects role permissions with OAuth scopes", () => {
  const names = listMcpTools(auth("STAFF", ["inventory:write", "sync:run"])).map((tool) => tool.name);
  assert.deepEqual(names, [
    "create_inventory_movement",
    "create_sales_return",
    "create_purchase_return",
    "create_consignment_direct_fulfillment",
  ]);
});

test("admin discovery includes explicitly granted admin tools", () => {
  const names = listMcpTools(auth("ADMIN", ["sync:run"])).map((tool) => tool.name);
  assert.deepEqual(names, ["run_sheet_sync"]);
});

test("tool execution repeats the role check server-side", async () => {
  await assert.rejects(
    callMcpTool("create_inventory_movement", {}, auth("VIEWER", ["inventory:write"])),
    /角色權限不足/,
  );
  await assert.rejects(
    callMcpTool("create_sales_return", {}, auth("STAFF", ["inventory:read"])),
    /scope 不足/,
  );
});

test("inventory write tools advertise confirmation-relevant annotations", () => {
  const tools = listMcpTools(auth("ADMIN", ["inventory:write", "movements:reverse", "sync:run"]));
  for (const name of ["create_inventory_movement", "create_sales_return", "create_purchase_return", "create_consignment_direct_fulfillment"]) {
    const definition = tools.find((tool) => tool.name === name);
    assert.deepEqual(definition?.annotations, { readOnlyHint: false, idempotentHint: false, destructiveHint: false });
    assert.ok(definition?.inputSchema.properties?.confirmationToken);
  }
  const reverse = tools.find((tool) => tool.name === "reverse_inventory_movement");
  const sync = tools.find((tool) => tool.name === "run_sheet_sync");
  assert.equal(reverse?.annotations.destructiveHint, true);
  assert.equal(sync?.annotations.readOnlyHint, false);
});

test("dedicated return and fulfillment tools require business-critical fields", () => {
  const tools = listMcpTools(auth("STAFF", ["inventory:write"]));
  assert.deepEqual(tools.find((tool) => tool.name === "create_sales_return")?.inputSchema.required, ["sku", "quantity", "channelId", "unitPrice"]);
  assert.deepEqual(tools.find((tool) => tool.name === "create_purchase_return")?.inputSchema.required, ["sku", "quantity"]);
  assert.deepEqual(tools.find((tool) => tool.name === "create_consignment_direct_fulfillment")?.inputSchema.required, ["sku", "sourceChannelId", "salesChannelId", "quantity", "unitPrice"]);
});

test("movement query schema includes return event types", () => {
  const movementList = listMcpTools(auth("STAFF", ["movements:read"])).find((tool) => tool.name === "list_inventory_movements");
  const typeSchema = movementList?.inputSchema.properties?.type as { enum?: string[] } | undefined;
  assert.ok(typeSchema?.enum?.includes("SALES_RETURN"));
  assert.ok(typeSchema?.enum?.includes("PURCHASE_RETURN"));
});
