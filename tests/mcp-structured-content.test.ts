import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMcpToolResult } from "../lib/mcp/registry";

test("list_billing_statements wraps array structuredContent in a dictionary", () => {
  const statements = [{ id: "billing-1", status: "ISSUED" }];
  const result = normalizeMcpToolResult("list_billing_statements", {
    content: [{ type: "text", text: JSON.stringify(statements) }],
    structuredContent: statements,
  });

  assert.deepEqual(result.structuredContent, { statements });
  assert.equal(Array.isArray(result.structuredContent), false);
});

test("other list tools wrap array structuredContent under items", () => {
  const channels = [{ id: "channel-1", name: "Store" }];
  const result = normalizeMcpToolResult("list_channels", {
    content: [{ type: "text", text: JSON.stringify(channels) }],
    structuredContent: channels,
  });

  assert.deepEqual(result.structuredContent, { items: channels });
});

test("object structuredContent remains unchanged", () => {
  const structuredContent = { totalAmount: 1200, status: "ISSUED" };
  const result = normalizeMcpToolResult("get_billing_statement", {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  });

  assert.equal(result.structuredContent, structuredContent);
});

test("scalar structuredContent is also normalized to a dictionary", () => {
  const result = normalizeMcpToolResult("example", {
    content: [{ type: "text", text: "true" }],
    structuredContent: true,
  });

  assert.deepEqual(result.structuredContent, { value: true });
});
