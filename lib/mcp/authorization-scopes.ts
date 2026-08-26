import { MCP_SCOPES, type McpScope } from "@/lib/mcp/oauth";

const supportedScopeSet = new Set<string>(MCP_SCOPES);

export function consentScopeOptions(requestedScopes: readonly McpScope[]) {
  const requestedScopeSet = new Set<McpScope>(requestedScopes);
  return MCP_SCOPES.map((scope) => ({
    scope,
    requested: requestedScopeSet.has(scope),
  }));
}

export function selectedConsentScopes(values: readonly unknown[]): McpScope[] {
  return [...new Set(values.filter((value): value is McpScope => (
    typeof value === "string" && supportedScopeSet.has(value)
  )))];
}
