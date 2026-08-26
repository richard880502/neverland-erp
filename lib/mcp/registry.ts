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

export function listMcpTools(auth?: McpAuth) {
  return [
    ...listCoreMcpTools(auth),
    ...listBillingMcpTools(auth),
  ];
}

export async function callMcpTool(name: string, input: unknown, auth: McpAuth) {
  if (hasBillingMcpTool(name)) return callBillingMcpTool(name, input, auth);
  return callCoreMcpTool(name, input, auth);
}
