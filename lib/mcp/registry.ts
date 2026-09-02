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

type McpToolDefinition = ReturnType<typeof listCoreMcpTools>[number];

const DATE_AWARE_INVENTORY_TOOLS = new Set([
  "create_inventory_movement",
  "create_sales_return",
  "create_purchase_return",
  "create_consignment_direct_fulfillment",
]);

const occurredOnProperty = {
  type: "string",
  format: "date",
  description: "異動營運日期，格式 YYYY-MM-DD。使用者有指定日期時必須傳此欄位；未指定時才使用建立當下時間。",
} as const;

function enhanceInventoryDateSchema(definition: McpToolDefinition): McpToolDefinition {
  if (!DATE_AWARE_INVENTORY_TOOLS.has(definition.name)) return definition;
  const existingOccurredAt = definition.inputSchema.properties?.occurredAt;
  return {
    ...definition,
    description: `${definition.description} 若使用者指定異動日期，必須傳 occurredOn (YYYY-MM-DD)，不要省略讓系統改用今天。`,
    inputSchema: {
      ...definition.inputSchema,
      properties: {
        ...definition.inputSchema.properties,
        occurredOn: occurredOnProperty,
        occurredAt: {
          ...(typeof existingOccurredAt === "object" && existingOccurredAt !== null ? existingOccurredAt : { type: "string", format: "date-time" }),
          description: "精確異動時間（RFC3339）。一般只指定日期時請改用 occurredOn；occurredOn 與 occurredAt 不可同時傳。",
        },
      },
    },
  };
}

function isValidDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizeInventoryDateInput(name: string, input: unknown) {
  if (!DATE_AWARE_INVENTORY_TOOLS.has(name) || input === null || typeof input !== "object" || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  if (record.occurredOn == null) return input;
  if (record.occurredAt != null) throw new Error("occurredOn 與 occurredAt 只能擇一");
  if (typeof record.occurredOn !== "string" || !isValidDateOnly(record.occurredOn)) {
    throw new Error("occurredOn 必須是有效的 YYYY-MM-DD 日期");
  }

  const { occurredOn, ...rest } = record;
  return {
    ...rest,
    // 用台北中午代表營運日期，避免 UTC 轉換後跨到前一天或後一天。
    occurredAt: `${occurredOn}T12:00:00+08:00`,
  };
}

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
    ...listCoreMcpTools(auth).map(enhanceInventoryDateSchema),
    ...listBillingMcpTools(auth),
  ];
}

export async function callMcpTool(name: string, input: unknown, auth: McpAuth) {
  const result = hasBillingMcpTool(name)
    ? await callBillingMcpTool(name, input, auth)
    : await callCoreMcpTool(name, normalizeInventoryDateInput(name, input), auth);
  return normalizeMcpToolResult(name, result);
}
