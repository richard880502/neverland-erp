import { Prisma } from "@prisma/client";
import { z } from "zod";
import { openBillingGoogleSheet } from "@/lib/billing-google-sheet";
import { prisma } from "@/lib/prisma";
import {
  billingCreateSchema,
  billingPreviewSchema,
  createBillingStatement,
  previewBillingStatement,
  voidBillingStatement,
} from "@/lib/services/billing";
import { consumeMcpAction, prepareMcpAction } from "@/lib/mcp/confirmation";
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

type StatementViewInput = {
  id: string;
  statementNo: string;
  channelId: string;
  sourceType: string;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
  dueDate: Date | null;
  companyName: string;
  taxId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  billingAddress: string | null;
  settlementRate: unknown;
  taxRate: unknown;
  subtotal: unknown;
  taxAmount: unknown;
  shippingFee: unknown;
  totalAmount: unknown;
  status: string;
  paidAt: Date | null;
  paidAmount: unknown;
  paymentMethod: string | null;
  paymentReference: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  channel: { id: string; name: string; type: string };
  items?: Array<{
    id: string;
    productId: string | null;
    sku: string;
    productName: string;
    size: string | null;
    listPrice: unknown;
    settlementPrice: unknown;
    quantity: number;
    subtotal: unknown;
  }>;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const billingStatusSchema = z.enum(["DRAFT", "ISSUED", "PAID", "VOID"]);
const confirmationProperty = {
  type: "string",
  description: "第一次 preview 回傳的短效單次 token；只有使用者確認後才能傳入。",
};

const mcpBillingItemSchema = z.object({
  productId: z.string().trim().min(1).optional(),
  sku: z.string().trim().min(1).max(80).optional(),
  quantity: z.coerce.number().int().min(1).max(1_000_000),
}).refine((value) => Boolean(value.productId || value.sku), {
  message: "每個請款品項至少需要 productId 或 sku",
});

const mcpBillingCreateSchema = z.object({
  channelId: z.string().trim().min(1),
  periodStart: z.string().regex(datePattern),
  periodEnd: z.string().regex(datePattern),
  issuedAt: z.string().regex(datePattern),
  settlementRate: z.coerce.number().gt(0).max(1),
  taxRate: z.coerce.number().min(0).max(1),
  shippingFee: z.coerce.number().min(0).max(1_000_000).default(0),
  note: z.string().trim().max(1000).optional().nullable(),
  items: z.array(mcpBillingItemSchema).min(1).max(200),
  confirmationToken: z.string().optional(),
}).refine((value) => value.periodStart <= value.periodEnd, {
  message: "請款期間起日不可晚於迄日",
});

function tool(definition: Tool) {
  return definition;
}

function json(result: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

function number(value: unknown) {
  return value == null ? null : Number(value);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dateOnly(value: Date | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function startOfTaipeiDate(value: string) {
  return new Date(`${value}T00:00:00+08:00`);
}

function endOfTaipeiDate(value: string) {
  return new Date(`${value}T23:59:59.999+08:00`);
}

function statementView(statement: StatementViewInput) {
  return {
    id: statement.id,
    statementNo: statement.statementNo,
    channel: statement.channel,
    sourceType: statement.sourceType,
    periodStart: dateOnly(statement.periodStart),
    periodEnd: dateOnly(statement.periodEnd),
    issuedAt: dateOnly(statement.issuedAt),
    dueDate: dateOnly(statement.dueDate),
    customer: {
      companyName: statement.companyName,
      taxId: statement.taxId,
      contactName: statement.contactName,
      contactEmail: statement.contactEmail,
      contactPhone: statement.contactPhone,
      billingAddress: statement.billingAddress,
    },
    settlementRate: number(statement.settlementRate),
    taxRate: number(statement.taxRate),
    subtotal: number(statement.subtotal),
    taxAmount: number(statement.taxAmount),
    shippingFee: number(statement.shippingFee),
    totalAmount: number(statement.totalAmount),
    status: statement.status,
    payment: {
      paidAt: dateOnly(statement.paidAt),
      paidAmount: number(statement.paidAmount),
      paymentMethod: statement.paymentMethod,
      paymentReference: statement.paymentReference,
    },
    note: statement.note,
    items: statement.items?.map((item) => ({
      id: item.id,
      productId: item.productId,
      sku: item.sku,
      productName: item.productName,
      size: item.size,
      listPrice: number(item.listPrice),
      settlementPrice: number(item.settlementPrice),
      quantity: item.quantity,
      subtotal: number(item.subtotal),
    })),
    createdAt: statement.createdAt,
    updatedAt: statement.updatedAt,
  };
}

async function findStatement(identifier: string) {
  const statement = await prisma.billingStatement.findFirst({
    where: { OR: [{ id: identifier }, { statementNo: identifier }] },
    include: {
      channel: { select: { id: true, name: true, type: true } },
      items: { orderBy: { sku: "asc" } },
    },
  });
  if (!statement) throw new Error("找不到請款單");
  return statement;
}

async function writeMcpAudit(
  auth: McpAuth,
  action: string,
  entityId: string,
  metadata: Record<string, Prisma.InputJsonValue>,
) {
  await prisma.auditLog.create({
    data: {
      userId: auth.userId,
      action,
      entityType: "BillingStatement",
      entityId,
      metadata: {
        source: "MCP",
        connectionId: auth.connectionId,
        clientId: auth.clientId,
        ...metadata,
      },
    },
  });
}

async function resolveCreateInput(raw: z.infer<typeof mcpBillingCreateSchema>) {
  const productIds = [...new Set(raw.items.flatMap((item) => item.productId ? [item.productId] : []))];
  const skus = [...new Set(raw.items.flatMap((item) => item.sku ? [item.sku] : []))];
  const products = await prisma.product.findMany({
    where: {
      active: true,
      OR: [
        ...(productIds.length ? [{ id: { in: productIds } }] : []),
        ...(skus.length ? [{ sku: { in: skus } }] : []),
      ],
    },
    select: {
      id: true,
      sku: true,
      name: true,
      size: true,
      listPrice: true,
      updatedAt: true,
    },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  const bySku = new Map(products.map((product) => [product.sku, product]));
  const normalizedItems = raw.items.map((item) => {
    const product = item.productId ? byId.get(item.productId) : item.sku ? bySku.get(item.sku) : undefined;
    if (!product) throw new Error(`找不到請款商品：${item.productId ?? item.sku}`);
    if (item.sku && item.productId && product.sku !== item.sku) throw new Error(`productId 與 SKU 不一致：${item.sku}`);
    return { productId: product.id, quantity: item.quantity };
  });
  const input = billingCreateSchema.parse({
    channelId: raw.channelId,
    periodStart: raw.periodStart,
    periodEnd: raw.periodEnd,
    issuedAt: raw.issuedAt,
    settlementRate: raw.settlementRate,
    taxRate: raw.taxRate,
    shippingFee: raw.shippingFee,
    note: raw.note ?? null,
    items: normalizedItems,
  });
  const channel = await prisma.channel.findUnique({
    where: { id: input.channelId },
    select: {
      id: true,
      name: true,
      type: true,
      active: true,
      companyName: true,
      taxId: true,
      updatedAt: true,
    },
  });
  if (!channel || !channel.active) throw new Error("找不到可用的客戶通路");
  if (!["CONSIGNMENT", "BUYOUT"].includes(channel.type)) throw new Error("請款目前僅支援寄賣與買斷通路");

  const uniqueProducts = [...new Map(products.map((product) => [product.id, product])).values()]
    .filter((product) => normalizedItems.some((item) => item.productId === product.id))
    .sort((a, b) => a.sku.localeCompare(b.sku, "zh-Hant", { numeric: true }));
  const pricing = uniqueProducts.map((product) => {
    if (product.listPrice == null) throw new Error(`商品 ${product.sku} 尚未設定建議售價`);
    const quantity = normalizedItems
      .filter((item) => item.productId === product.id)
      .reduce((sum, item) => sum + item.quantity, 0);
    const listPrice = Number(product.listPrice);
    const settlementPrice = roundMoney(listPrice * input.settlementRate);
    return {
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      size: product.size,
      quantity,
      listPrice,
      settlementPrice,
      subtotal: roundMoney(settlementPrice * quantity),
      updatedAt: product.updatedAt.toISOString(),
    };
  });
  const subtotal = roundMoney(pricing.reduce((sum, item) => sum + item.subtotal, 0));
  const taxAmount = roundMoney(subtotal * input.taxRate);
  const shippingFee = roundMoney(input.shippingFee);
  const totalAmount = roundMoney(subtotal + taxAmount + shippingFee);
  const confirmationPayload = {
    input,
    channelSnapshot: {
      id: channel.id,
      name: channel.name,
      companyName: channel.companyName,
      taxId: channel.taxId,
      type: channel.type,
      updatedAt: channel.updatedAt.toISOString(),
    },
    pricing: pricing.map(({ updatedAt, ...item }) => ({ ...item, updatedAt })),
  } as Prisma.InputJsonValue;
  return {
    input,
    channel,
    pricing,
    totals: { subtotal, taxAmount, shippingFee, totalAmount },
    confirmationPayload,
  };
}

const billingTools: Tool[] = [
  tool({
    name: "list_billing_statements",
    description: "列出請款單，可依通路、公司/單號關鍵字、狀態與開立日期區間篩選。",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string" },
        query: { type: "string", description: "請款單號或公司名稱關鍵字" },
        status: { type: "string", enum: billingStatusSchema.options },
        from: { type: "string", format: "date", description: "開立日起日" },
        to: { type: "string", format: "date", description: "開立日迄日" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        offset: { type: "integer", minimum: 0 },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    scope: "billing:read",
    run: async (raw) => {
      const input = z.object({
        channelId: z.string().trim().min(1).optional(),
        query: z.string().trim().max(160).optional(),
        status: billingStatusSchema.optional(),
        from: z.string().regex(datePattern).optional(),
        to: z.string().regex(datePattern).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
        offset: z.coerce.number().int().min(0).default(0),
      }).refine((value) => !value.from || !value.to || value.from <= value.to, {
        message: "日期起日不可晚於迄日",
      }).parse(raw);
      const statements = await prisma.billingStatement.findMany({
        where: {
          ...(input.channelId ? { channelId: input.channelId } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.query ? {
            OR: [
              { statementNo: { contains: input.query, mode: "insensitive" } },
              { companyName: { contains: input.query, mode: "insensitive" } },
            ],
          } : {}),
          ...(input.from || input.to ? {
            issuedAt: {
              ...(input.from ? { gte: startOfTaipeiDate(input.from) } : {}),
              ...(input.to ? { lte: endOfTaipeiDate(input.to) } : {}),
            },
          } : {}),
        },
        include: {
          channel: { select: { id: true, name: true, type: true } },
          _count: { select: { items: true } },
        },
        orderBy: [{ issuedAt: "desc" }, { statementNo: "desc" }],
        take: input.limit,
        skip: input.offset,
      });
      return statements.map((statement) => ({
        id: statement.id,
        statementNo: statement.statementNo,
        channel: statement.channel,
        companyName: statement.companyName,
        sourceType: statement.sourceType,
        periodStart: dateOnly(statement.periodStart),
        periodEnd: dateOnly(statement.periodEnd),
        issuedAt: dateOnly(statement.issuedAt),
        dueDate: dateOnly(statement.dueDate),
        status: statement.status,
        subtotal: Number(statement.subtotal),
        taxAmount: Number(statement.taxAmount),
        shippingFee: Number(statement.shippingFee),
        totalAmount: Number(statement.totalAmount),
        itemCount: statement._count.items,
      }));
    },
  }),
  tool({
    name: "get_billing_statement",
    description: "依 BillingStatement ID 或 BL-... 請款單號取得完整請款快照與品項。",
    inputSchema: {
      type: "object",
      required: ["statement"],
      properties: { statement: { type: "string", description: "BillingStatement ID 或 BL-... 單號" } },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    scope: "billing:read",
    run: async (raw) => {
      const { statement } = z.object({ statement: z.string().trim().min(1).max(120) }).parse(raw);
      return statementView(await findStatement(statement));
    },
  }),
  tool({
    name: "preview_billing_statement",
    description: "依客戶通路與日期區間產生請款建議，不建立正式請款單；會依結算折數、稅率與運費估算總額。",
    inputSchema: {
      type: "object",
      required: ["channelId", "periodStart", "periodEnd"],
      properties: {
        channelId: { type: "string" },
        periodStart: { type: "string", format: "date" },
        periodEnd: { type: "string", format: "date" },
        settlementRate: { type: "number", exclusiveMinimum: 0, maximum: 1, description: "可覆蓋通路預設結算折數" },
        taxRate: { type: "number", minimum: 0, maximum: 1, description: "可覆蓋通路預設稅率" },
        shippingFee: { type: "number", minimum: 0 },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    scope: "billing:read",
    run: async (raw) => {
      const input = z.object({
        channelId: z.string().trim().min(1),
        periodStart: z.string().regex(datePattern),
        periodEnd: z.string().regex(datePattern),
        settlementRate: z.coerce.number().gt(0).max(1).optional(),
        taxRate: z.coerce.number().min(0).max(1).optional(),
        shippingFee: z.coerce.number().min(0).max(1_000_000).default(0),
      }).refine((value) => value.periodStart <= value.periodEnd, {
        message: "請款期間起日不可晚於迄日",
      }).parse(raw);
      const previewInput = billingPreviewSchema.parse({
        channelId: input.channelId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      });
      const [preview, channel] = await Promise.all([
        previewBillingStatement(previewInput),
        prisma.channel.findUnique({ where: { id: input.channelId } }),
      ]);
      if (!channel || !channel.active) throw new Error("找不到可用的客戶通路");
      const settlementRate = input.settlementRate ?? (channel.settlementRate == null ? null : Number(channel.settlementRate));
      const taxRate = input.taxRate ?? (channel.taxRate == null ? null : Number(channel.taxRate));
      const pricedItems = preview.items.map((item) => {
        const settlementPrice = item.listPrice == null || settlementRate == null
          ? null
          : roundMoney(item.listPrice * settlementRate);
        return {
          ...item,
          settlementPrice,
          subtotal: settlementPrice == null ? null : roundMoney(settlementPrice * item.quantity),
        };
      });
      const canCalculate = settlementRate != null && taxRate != null && pricedItems.every((item) => item.subtotal != null);
      const subtotal = canCalculate
        ? roundMoney(pricedItems.reduce((sum, item) => sum + (item.subtotal ?? 0), 0))
        : null;
      const taxAmount = subtotal == null || taxRate == null ? null : roundMoney(subtotal * taxRate);
      const totalAmount = subtotal == null || taxAmount == null
        ? null
        : roundMoney(subtotal + taxAmount + input.shippingFee);
      return {
        channel: {
          id: channel.id,
          name: channel.name,
          type: channel.type,
          companyName: channel.companyName,
          taxId: channel.taxId,
        },
        sourceType: preview.sourceType,
        sourceMovementCount: preview.sourceMovementCount,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        settlementRate,
        taxRate,
        shippingFee: input.shippingFee,
        items: pricedItems,
        totals: { subtotal, taxAmount, shippingFee: input.shippingFee, totalAmount },
        canCreateWithCurrentPricing: canCalculate && pricedItems.length > 0,
      };
    },
  }),
  tool({
    name: "create_billing_statement",
    description: "建立正式請款單。第一次呼叫只產生金額 preview 與 confirmationToken；使用者明確確認後以完全相同參數再呼叫才會建立。",
    inputSchema: {
      type: "object",
      required: ["channelId", "periodStart", "periodEnd", "issuedAt", "settlementRate", "taxRate", "items"],
      properties: {
        channelId: { type: "string" },
        periodStart: { type: "string", format: "date" },
        periodEnd: { type: "string", format: "date" },
        issuedAt: { type: "string", format: "date" },
        settlementRate: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        taxRate: { type: "number", minimum: 0, maximum: 1 },
        shippingFee: { type: "number", minimum: 0 },
        note: { type: "string" },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 200,
          items: {
            type: "object",
            required: ["quantity"],
            properties: {
              productId: { type: "string" },
              sku: { type: "string" },
              quantity: { type: "integer", minimum: 1 },
            },
          },
        },
        confirmationToken: confirmationProperty,
      },
    },
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
    scope: "billing:write",
    run: async (raw, auth) => {
      const parsed = mcpBillingCreateSchema.parse(raw);
      const { confirmationToken } = parsed;
      const resolved = await resolveCreateInput(parsed);
      if (!confirmationToken) {
        return prepareMcpAction(
          "create_billing_statement",
          resolved.confirmationPayload,
          auth,
          {
            action: "建立正式請款單",
            channel: {
              id: resolved.channel.id,
              name: resolved.channel.name,
              companyName: resolved.channel.companyName,
              type: resolved.channel.type,
            },
            periodStart: resolved.input.periodStart,
            periodEnd: resolved.input.periodEnd,
            issuedAt: resolved.input.issuedAt,
            settlementRate: resolved.input.settlementRate,
            taxRate: resolved.input.taxRate,
            items: resolved.pricing.map(({ updatedAt: _updatedAt, ...item }) => item),
            totals: resolved.totals,
            note: resolved.input.note,
          },
        );
      }
      await consumeMcpAction(
        "create_billing_statement",
        confirmationToken,
        resolved.confirmationPayload,
        auth,
      );
      const created = await createBillingStatement(resolved.input, { userId: auth.userId, role: auth.role });
      await writeMcpAudit(auth, "MCP_BILLING_STATEMENT_CREATED", created.id, {
        statementNo: created.statementNo,
        totalAmount: Number(created.totalAmount),
      });
      return { committed: true, statement: statementView(created) };
    },
  }),
  tool({
    name: "void_billing_statement",
    description: "作廢待收款請款單。第一次只回傳 preview；使用者明確確認後帶 confirmationToken 再呼叫才會作廢。",
    inputSchema: {
      type: "object",
      required: ["statement"],
      properties: {
        statement: { type: "string", description: "BillingStatement ID 或 BL-... 單號" },
        confirmationToken: confirmationProperty,
      },
    },
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    scope: "billing:write",
    run: async (raw, auth) => {
      const input = z.object({ statement: z.string().trim().min(1).max(120), confirmationToken: z.string().optional() }).parse(raw);
      const statement = await findStatement(input.statement);
      const payload = {
        statementId: statement.id,
        statementNo: statement.statementNo,
        status: statement.status,
        updatedAt: statement.updatedAt.toISOString(),
        totalAmount: Number(statement.totalAmount),
      } as Prisma.InputJsonValue;
      if (!input.confirmationToken) {
        if (statement.status !== "ISSUED") throw new Error("只有待收款請款單可以作廢");
        return prepareMcpAction("void_billing_statement", payload, auth, {
          action: "作廢請款單",
          statement: statementView(statement),
        });
      }
      await consumeMcpAction("void_billing_statement", input.confirmationToken, payload, auth);
      const updated = await voidBillingStatement(statement.id, { userId: auth.userId, role: auth.role });
      await writeMcpAudit(auth, "MCP_BILLING_STATEMENT_VOIDED", updated.id, {
        statementNo: updated.statementNo,
      });
      return { committed: true, statement: { id: updated.id, statementNo: updated.statementNo, status: updated.status } };
    },
  }),
  tool({
    name: "create_billing_google_sheet",
    description: "為既有請款單建立或開啟 Google 試算表頁籤。第一次只回傳 preview；確認後才會呼叫 Google Sheets。既有 BL-... 頁籤不會被覆寫。",
    inputSchema: {
      type: "object",
      required: ["statement"],
      properties: {
        statement: { type: "string", description: "BillingStatement ID 或 BL-... 單號" },
        confirmationToken: confirmationProperty,
      },
    },
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
    scope: "billing:write",
    run: async (raw, auth) => {
      const input = z.object({ statement: z.string().trim().min(1).max(120), confirmationToken: z.string().optional() }).parse(raw);
      const statement = await findStatement(input.statement);
      const payload = {
        statementId: statement.id,
        statementNo: statement.statementNo,
        updatedAt: statement.updatedAt.toISOString(),
      } as Prisma.InputJsonValue;
      if (!input.confirmationToken) {
        return prepareMcpAction("create_billing_google_sheet", payload, auth, {
          action: "建立或開啟 Google 試算表請款頁籤",
          statement: {
            id: statement.id,
            statementNo: statement.statementNo,
            companyName: statement.companyName,
            totalAmount: Number(statement.totalAmount),
            status: statement.status,
          },
          note: "若同名 BL-... 頁籤已存在，只會開啟既有頁籤，不會覆寫人工修改。",
        });
      }
      await consumeMcpAction("create_billing_google_sheet", input.confirmationToken, payload, auth);
      const sheet = await openBillingGoogleSheet(statement.id, auth.userId);
      await writeMcpAudit(auth, "MCP_BILLING_GOOGLE_SHEET_OPENED", statement.id, {
        statementNo: statement.statementNo,
        created: sheet.created,
        sheetId: sheet.sheetId,
        sheetName: sheet.sheetName,
      });
      return { committed: true, statementNo: statement.statementNo, ...sheet };
    },
  }),
];

function roleAllowsTool(definition: Tool, role: McpAuth["role"]) {
  if (role === "ADMIN" || role === "STAFF") return true;
  return definition.annotations.readOnlyHint === true;
}

export function hasBillingMcpTool(name: string) {
  return billingTools.some((tool) => tool.name === name);
}

export function listBillingMcpTools(auth?: McpAuth) {
  return billingTools
    .filter((definition) => !auth || (auth.scopes.includes(definition.scope) && roleAllowsTool(definition, auth.role)))
    .map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations }));
}

export async function callBillingMcpTool(name: string, input: unknown, auth: McpAuth) {
  const definition = billingTools.find((tool) => tool.name === name);
  if (!definition) throw new Error("找不到 Billing MCP tool");
  if (!auth.scopes.includes(definition.scope)) throw new Error("OAuth scope 不足");
  if (!roleAllowsTool(definition, auth.role)) throw new Error("ERP 角色權限不足");
  return json(await definition.run(input ?? {}, auth));
}
