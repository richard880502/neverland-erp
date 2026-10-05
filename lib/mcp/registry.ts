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
import {
  callFinanceMcpTool,
  hasFinanceMcpTool,
  listFinanceMcpTools,
} from "@/lib/mcp/finance-tools";

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

const DATE_ALIAS_KEYS = ["date", "movementDate", "movement_date", "occurredDate", "occurred_date", "occurred_on", "occurred_at", "eventDate", "transactionDate", "operationDate"];

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
  // zod 會默默丟掉未定義欄位；agent 若用別名傳日期，異動會被記成今天，所以直接拒絕。
  const aliases = DATE_ALIAS_KEYS.filter((key) => record[key] != null);
  if (aliases.length) throw new Error(`不支援欄位 ${aliases.join("、")}；異動日期請改用 occurredOn (YYYY-MM-DD)`);
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

// preview 一律明示寫入日期，沒指定時也要說清楚會用「確認當下」，讓 agent 與使用者能發現日期漏傳。
function annotatePreviewDate(name: string, input: unknown, result: McpToolResult): McpToolResult {
  const content = result.structuredContent as Record<string, unknown> | null | undefined;
  if (!DATE_AWARE_INVENTORY_TOOLS.has(name) || !content || typeof content !== "object" || content.requiresConfirmation !== true) return result;
  const normalized = normalizeInventoryDateInput(name, input) as Record<string, unknown> | null;
  const raw = normalized && typeof normalized === "object" ? normalized.occurredAt : undefined;
  const parsed = raw == null ? null : new Date(String(raw));
  const effectiveOccurredAt = parsed && !Number.isNaN(parsed.getTime())
    ? { source: "specified", value: parsed.toISOString(), taipeiDate: parsed.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }) }
    : { source: "not-specified", value: null, note: "未指定日期：確認時會以當下時間（今天）寫入。若使用者有指定日期，請取消並用 occurredOn 重新 preview。" };
  const next = { ...content, preview: { ...(content.preview as object), effectiveOccurredAt } };
  return { ...result, structuredContent: next, content: [{ type: "text", text: JSON.stringify(next, null, 2) }] } as McpToolResult;
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
    ...listFinanceMcpTools(auth),
  ];
}

export async function callMcpTool(name: string, input: unknown, auth: McpAuth) {
  const result = hasBillingMcpTool(name)
    ? await callBillingMcpTool(name, input, auth)
    : hasFinanceMcpTool(name)
      ? await callFinanceMcpTool(name, input, auth)
      : await callCoreMcpTool(name, normalizeInventoryDateInput(name, input), auth);
  return normalizeMcpToolResult(name, annotatePreviewDate(name, input, result));
}
