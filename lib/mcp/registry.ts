import type { McpAuth } from "@/lib/mcp/oauth";
import {
  callMcpTool as callCoreMcpTool,
  listMcpTools as listCoreMcpTools,
} from "@/lib/mcp/tools";
import {
  callBillingMcpTool,
  hasBillingMcpTool,
  listBillingMcpTools,
} from "@/lib/mcp/billing-tools";

type McpToolResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: unknown;
  [key: string]: unknown;
};

export function normalizeMcpToolResult(name: string, result: McpToolResult) {
  const structuredContent = result.structuredContent;
  if (structuredContent !== null && typeof structuredContent === "object" && !Array.isArray(structuredContent)) {
    return result;
  }

  return {
    ...result,
    structuredContent: Array.isArray(structuredContent)
      ? { [name === "list_billing_statements" ? "statements" : "items"]: structuredContent }
      : { value: structuredContent ?? null },
  };
}

export function listMcpTools(auth?: McpAuth) {
  return [
    ...listCoreMcpTools(auth),
    ...listBillingMcpTools(auth),
  ];
}

export async function callMcpTool(name: string, input: unknown, auth: McpAuth) {
  const result = hasBillingMcpTool(name)
    ? await callBillingMcpTool(name, input, auth)
    : await callCoreMcpTool(name, input, auth);
  return normalizeMcpToolResult(name, result);
}
