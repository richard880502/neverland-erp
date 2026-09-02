import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getBillingFinanceTrace } from "@/lib/services/billing-finance-trace";
import { getDirectSettlementFinanceTrace } from "@/lib/services/direct-settlement-finance-trace";
import { getFinanceDashboardByDates } from "@/lib/services/finance-range";
import { getFinanceTransactionDetail, listFinanceCategories } from "@/lib/services/finance";
import type { McpAuth, McpScope } from "@/lib/mcp/oauth";

type Tool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
  annotations: Record<string, boolean>;
  scope: McpScope;
  run: (input: unknown, auth: McpAuth) => Promise<unknown>;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const directionSchema = z.enum(["INCOME", "EXPENSE"]);
const paymentStatusSchema = z.enum(["PENDING", "PARTIAL", "PAID", "REFUNDED", "VOID"]);
const reconciliationStatusSchema = z.enum(["UNMATCHED", "MATCHED", "RECONCILED"]);
const invoiceStatusSchema = z.enum(["MISSING", "RECEIVED", "VOIDED", "CREDITED", "NOT_REQUIRED"]);
const sourceSchema = z.enum(["MANUAL", "EXCEL", "BILLING", "SHOPEE", "BANK", "OTHER"]);

function tool(definition: Tool) {
  return definition;
}

function json(result: unknown) {
  const normalized = plain(result);
  return {
    content: [{ type: "text", text: JSON.stringify(normalized, null, 2) }],
    structuredContent: normalized,
  };
}

function plain(value: unknown): unknown {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return Number(value);
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, plain(entry)]));
  }
  return String(value);
}

function dateOnly(value: Date | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function taipeiToday() {
  return dateOnly(new Date()) as string;
}

function startOfTaipeiDate(value: string) {
  return new Date(`${value}T00:00:00+08:00`);
}

function endOfTaipeiDate(value: string) {
  return new Date(`${value}T23:59:59.999+08:00`);
}

function resolvePeriod(start?: string, end?: string) {
  if ((start && !end) || (!start && end)) throw new Error("start 與 end 必須一起提供");
  if (start && end) {
    if (start > end) throw new Error("開始日期不能晚於結束日期");
    return { start, end };
  }
  const today = taipeiToday();
  return { start: `${today.slice(0, 7)}-01`, end: today };
}

function transactionSearchWhere(query?: string) {
  if (!query) return {};
  return {
    OR: [
      { summary: { contains: query, mode: "insensitive" as const } },
      { counterparty: { contains: query, mode: "insensitive" as const } },
      { relatedParty: { contains: query, mode: "insensitive" as const } },
      { salesChannel: { contains: query, mode: "insensitive" as const } },
      { sourceRef: { contains: query, mode: "insensitive" as const } },
      { note: { contains: query, mode: "insensitive" as const } },
      { items: { some: { OR: [
        { productName: { contains: query, mode: "insensitive" as const } },
        { sku: { contains: query, mode: "insensitive" as const } },
      ] } } },
    ],
  };
}

const financeTools: Tool[] = [
  tool({
    name: "get_finance_summary",
    description: "取得指定期間的財務摘要，沿用 ERP 財務儀表板的淨營收、退款、支出、應收、現金流、COGS、毛利與預估淨利計算。未提供日期時預設本月至今天。",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "string", format: "date", description: "起日 YYYY-MM-DD；與 end 一起提供" },
        end: { type: "string", format: "date", description: "迄日 YYYY-MM-DD；與 start 一起提供" },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    scope: "finance:read",
    run: async (raw) => {
      const input = z.object({
        start: z.string().regex(datePattern).optional(),
        end: z.string().regex(datePattern).optional(),
      }).parse(raw);
      const period = resolvePeriod(input.start, input.end);
      const dashboard = await getFinanceDashboardByDates(period.start, period.end);
      return { period, dashboard };
    },
  }),
  tool({
    name: "list_finance_transactions",
    description: "查詢財務收支明細，可依日期、收入/支出、付款、對帳、發票、通路、分類、來源與關鍵字篩選。",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "string", format: "date" },
        end: { type: "string", format: "date" },
        direction: { type: "string", enum: directionSchema.options },
        paymentStatus: { type: "string", enum: paymentStatusSchema.options },
        reconciliationStatus: { type: "string", enum: reconciliationStatusSchema.options },
        invoiceStatus: { type: "string", enum: invoiceStatusSchema.options },
        channelId: { type: "string" },
        categoryId: { type: "string" },
        source: { type: "string", enum: sourceSchema.options },
        query: { type: "string", description: "摘要、對象、通路、來源單號、備註、商品名稱或 SKU" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        offset: { type: "integer", minimum: 0 },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    scope: "finance:read",
    run: async (raw) => {
      const input = z.object({
        start: z.string().regex(datePattern).optional(),
        end: z.string().regex(datePattern).optional(),
        direction: directionSchema.optional(),
        paymentStatus: paymentStatusSchema.optional(),
        reconciliationStatus: reconciliationStatusSchema.optional(),
        invoiceStatus: invoiceStatusSchema.optional(),
        channelId: z.string().trim().min(1).optional(),
        categoryId: z.string().trim().min(1).optional(),
        source: sourceSchema.optional(),
        query: z.string().trim().max(160).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
        offset: z.coerce.number().int().min(0).max(100_000).default(0),
      }).refine((value) => !value.start || !value.end || value.start <= value.end, {
        message: "開始日期不能晚於結束日期",
      }).parse(raw);

      const where = {
        ...(input.start || input.end ? {
          occurredAt: {
            ...(input.start ? { gte: startOfTaipeiDate(input.start) } : {}),
            ...(input.end ? { lte: endOfTaipeiDate(input.end) } : {}),
          },
        } : {}),
        ...(input.direction ? { direction: input.direction } : {}),
        ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
        ...(input.reconciliationStatus ? { reconciliationStatus: input.reconciliationStatus } : {}),
        ...(input.invoiceStatus ? { invoiceStatus: input.invoiceStatus } : {}),
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...transactionSearchWhere(input.query),
      };

      const [rows, total] = await Promise.all([
        prisma.financeTransaction.findMany({
          where,
          include: {
            category: { include: { parent: { select: { id: true, code: true, name: true } } } },
            channel: { select: { id: true, name: true, type: true } },
            items: {
              select: { productId: true, sku: true, productName: true, size: true, quantity: true, lineAmount: true },
              take: 10,
              orderBy: { id: "asc" },
            },
            invoices: { orderBy: { createdAt: "desc" }, take: 1 },
            _count: { select: { items: true, invoices: true } },
          },
          orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
          take: input.limit,
          skip: input.offset,
        }),
        prisma.financeTransaction.count({ where }),
      ]);

      return {
        total,
        offset: input.offset,
        limit: input.limit,
        hasMore: input.offset + rows.length < total,
        transactions: rows.map((row) => ({
          id: row.id,
          occurredOn: dateOnly(row.occurredAt),
          direction: row.direction,
          amount: Number(row.amount),
          category: row.category ? {
            id: row.category.id,
            code: row.category.code,
            name: row.category.name,
            parent: row.category.parent,
          } : null,
          channel: row.channel,
          counterparty: row.counterparty,
          relatedParty: row.relatedParty,
          salesChannel: row.salesChannel,
          summary: row.summary,
          paymentStatus: row.paymentStatus,
          reconciliationStatus: row.reconciliationStatus,
          invoiceStatus: row.invoiceStatus,
          latestInvoiceNo: row.invoices[0]?.invoiceNo ?? null,
          source: row.source,
          sourceRef: row.sourceRef,
          note: row.note,
          itemCount: row._count.items,
          invoiceCount: row._count.invoices,
          itemsPreview: row.items.map((item) => ({
            ...item,
            lineAmount: Number(item.lineAmount),
          })),
        })),
      };
    },
  }),
  tool({
    name: "get_finance_transaction",
    description: "取得單筆財務交易完整明細，包含商品、發票，以及若來源為請款或直營撥款結算時的原始銷貨追溯。",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", description: "FinanceTransaction id" } },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    scope: "finance:read",
    run: async (raw) => {
      const { id } = z.object({ id: z.string().trim().min(1) }).parse(raw);
      const transaction = await getFinanceTransactionDetail(id);
      if (!transaction) throw new Error("找不到收支紀錄");
      const [billingSettlement, directSettlement] = await Promise.all([
        getBillingFinanceTrace(transaction.sourceRef),
        getDirectSettlementFinanceTrace(transaction.sourceRef),
      ]);
      return { transaction, billingSettlement, directSettlement };
    },
  }),
  tool({
    name: "list_finance_receivables",
    description: "列出目前 Finance 中付款狀態為待收或部分收款的收入，可依日期、通路與關鍵字篩選。",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "string", format: "date" },
        end: { type: "string", format: "date" },
        channelId: { type: "string" },
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        offset: { type: "integer", minimum: 0 },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    scope: "finance:read",
    run: async (raw) => {
      const input = z.object({
        start: z.string().regex(datePattern).optional(),
        end: z.string().regex(datePattern).optional(),
        channelId: z.string().trim().min(1).optional(),
        query: z.string().trim().max(160).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
        offset: z.coerce.number().int().min(0).max(100_000).default(0),
      }).refine((value) => !value.start || !value.end || value.start <= value.end, {
        message: "開始日期不能晚於結束日期",
      }).parse(raw);

      const where = {
        direction: "INCOME" as const,
        paymentStatus: { in: ["PENDING", "PARTIAL"] as const },
        ...(input.start || input.end ? {
          occurredAt: {
            ...(input.start ? { gte: startOfTaipeiDate(input.start) } : {}),
            ...(input.end ? { lte: endOfTaipeiDate(input.end) } : {}),
          },
        } : {}),
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...transactionSearchWhere(input.query),
      };

      const [rows, total, sum] = await Promise.all([
        prisma.financeTransaction.findMany({
          where,
          include: {
            category: { select: { id: true, code: true, name: true } },
            channel: { select: { id: true, name: true, type: true } },
          },
          orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
          take: input.limit,
          skip: input.offset,
        }),
        prisma.financeTransaction.count({ where }),
        prisma.financeTransaction.aggregate({ where, _sum: { amount: true } }),
      ]);

      return {
        total,
        trackedReceivableAmount: Number(sum._sum.amount ?? 0),
        note: "PARTIAL 目前在 FinanceTransaction 未另存已收金額，因此此合計沿用 ERP 儀表板語意，會以該交易整筆金額納入應收。",
        offset: input.offset,
        limit: input.limit,
        hasMore: input.offset + rows.length < total,
        receivables: rows.map((row) => ({
          id: row.id,
          occurredOn: dateOnly(row.occurredAt),
          amount: Number(row.amount),
          paymentStatus: row.paymentStatus,
          category: row.category,
          channel: row.channel,
          counterparty: row.counterparty,
          salesChannel: row.salesChannel,
          summary: row.summary,
          source: row.source,
          sourceRef: row.sourceRef,
        })),
      };
    },
  }),
  tool({
    name: "list_missing_expense_invoices",
    description: "列出尚缺發票/憑證的支出，排除已作廢交易，可依日期、分類與關鍵字篩選。",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "string", format: "date" },
        end: { type: "string", format: "date" },
        categoryId: { type: "string" },
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        offset: { type: "integer", minimum: 0 },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    scope: "finance:read",
    run: async (raw) => {
      const input = z.object({
        start: z.string().regex(datePattern).optional(),
        end: z.string().regex(datePattern).optional(),
        categoryId: z.string().trim().min(1).optional(),
        query: z.string().trim().max(160).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
        offset: z.coerce.number().int().min(0).max(100_000).default(0),
      }).refine((value) => !value.start || !value.end || value.start <= value.end, {
        message: "開始日期不能晚於結束日期",
      }).parse(raw);

      const where = {
        direction: "EXPENSE" as const,
        invoiceStatus: "MISSING" as const,
        paymentStatus: { not: "VOID" as const },
        ...(input.start || input.end ? {
          occurredAt: {
            ...(input.start ? { gte: startOfTaipeiDate(input.start) } : {}),
            ...(input.end ? { lte: endOfTaipeiDate(input.end) } : {}),
          },
        } : {}),
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        ...transactionSearchWhere(input.query),
      };

      const [rows, total, sum] = await Promise.all([
        prisma.financeTransaction.findMany({
          where,
          include: {
            category: { include: { parent: { select: { id: true, code: true, name: true } } } },
          },
          orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
          take: input.limit,
          skip: input.offset,
        }),
        prisma.financeTransaction.count({ where }),
        prisma.financeTransaction.aggregate({ where, _sum: { amount: true } }),
      ]);

      return {
        total,
        totalAmount: Number(sum._sum.amount ?? 0),
        offset: input.offset,
        limit: input.limit,
        hasMore: input.offset + rows.length < total,
        expenses: rows.map((row) => ({
          id: row.id,
          occurredOn: dateOnly(row.occurredAt),
          amount: Number(row.amount),
          category: row.category ? {
            id: row.category.id,
            code: row.category.code,
            name: row.category.name,
            parent: row.category.parent,
          } : null,
          counterparty: row.counterparty,
          relatedParty: row.relatedParty,
          summary: row.summary,
          paymentStatus: row.paymentStatus,
          invoiceStatus: row.invoiceStatus,
          source: row.source,
          sourceRef: row.sourceRef,
          note: row.note,
        })),
      };
    },
  }),
  tool({
    name: "list_finance_categories",
    description: "列出目前啟用中的財務分類與收入/支出方向，供後續查詢使用。",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    scope: "finance:read",
    run: async () => ({ categories: await listFinanceCategories() }),
  }),
];

export function listFinanceMcpTools(auth?: McpAuth) {
  return financeTools
    .filter((definition) => !auth || auth.scopes.includes(definition.scope))
    .map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations }));
}

export function hasFinanceMcpTool(name: string) {
  return financeTools.some((definition) => definition.name === name);
}

export async function callFinanceMcpTool(name: string, input: unknown, auth: McpAuth) {
  const definition = financeTools.find((item) => item.name === name);
  if (!definition) throw new Error("找不到 Finance MCP tool");
  if (!auth.scopes.includes(definition.scope)) throw new Error("OAuth scope 不足");
  return json(await definition.run(input ?? {}, auth));
}
