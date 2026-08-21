import assert from "node:assert/strict";
import test from "node:test";
import type { McpAuth } from "../lib/mcp/oauth";
import { listMcpTools } from "../lib/mcp/tools";

function auth(role: McpAuth["role"], scopes: McpAuth["scopes"]): McpAuth {
  return { userId: "user", role, scopes, connectionId: "connection", clientId: "client" };
}

test("viewer discovery exposes only authorized read tools", () => {
  const names = listMcpTools(auth("VIEWER", ["inventory:read", "inventory:write"])).map((tool) => tool.name);
  assert.deepEqual(names, ["get_inventory", "get_inventory_by_channel", "get_low_stock"]);
});

test("staff discovery intersects role permissions with OAuth scopes", () => {
  const names = listMcpTools(auth("STAFF", ["inventory:write", "sync:run"])).map((tool) => tool.name);
  assert.deepEqual(names, ["create_inventory_movement"]);
});

test("admin discovery includes explicitly granted admin tools", () => {
  const names = listMcpTools(auth("ADMIN", ["sync:run"])).map((tool) => tool.name);
  assert.deepEqual(names, ["run_sheet_sync"]);
});
