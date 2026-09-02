import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";
import type { McpAuth } from "../../lib/mcp/oauth";
import { callMcpTool } from "../../lib/mcp/registry";
import { createFinanceTransaction, financeCreateSchema } from "../../lib/services/finance";

const email = "mcp-finance-integration@example.com";
const incomeCode = "mcp_finance_income";
const expenseCode = "mcp_finance_expense";

type McpResult<T> = {
  content: Array<{ type: string; text: string }>;
  structuredContent: T;
};

function auth(userId: string, scopes: McpAuth["scopes"]): McpAuth {
  return {
    userId,
    role: "VIEWER",
    scopes,
    connectionId: "mcp-finance-integration-connection",
    clientId: "mcp-finance-integration-client",
  };
}

async function cleanup() {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    await prisma.financeTransaction.deleteMany({ where: { createdById: user.id } });
    await prisma.auditLog.deleteMany({ where: { userId: user.id } });
  }
  await prisma.financeCategory.deleteMany({ where: { code: { in: [incomeCode, expenseCode] } } });
  await prisma.user.deleteMany({ where: { email } });
}

test.before(cleanup);
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("finance MCP returns dashboard-consistent read-only finance data", async () => {
  const user = await prisma.user.create({
    data: {
      email,
      name: "MCP Finance Integration",
      passwordHash: "unused",
      role: "STAFF",
      mustChangePassword: false,
    },
  });
  const [incomeCategory, expenseCategory] = await Promise.all([
    prisma.financeCategory.create({
      data: { id: randomUUID(), code: incomeCode, name: "MCP Finance Income", direction: "INCOME" },
    }),
    prisma.financeCategory.create({
      data: { id: randomUUID(), code: expenseCode, name: "MCP Finance Expense", direction: "EXPENSE" },
    }),
  ]);

  const pending = await createFinanceTransaction(financeCreateSchema.parse({
    occurredAt: "2026-08-05",
    direction: "INCOME",
    amount: 1000,
    categoryId: incomeCategory.id,
    counterparty: "MCP Finance Customer",
    summary: "MCP Finance pending receivable",
    paymentStatus: "PENDING",
    reconciliationStatus: "UNMATCHED",
    invoiceStatus: "NOT_REQUIRED",
    source: "MANUAL",
    items: [],
  }), { userId: user.id, role: "STAFF" });

  await createFinanceTransaction(financeCreateSchema.parse({
    occurredAt: "2026-08-10",
    direction: "INCOME",
    amount: 500,
    categoryId: incomeCategory.id,
    counterparty: "MCP Finance Customer",
    summary: "MCP Finance paid income",
    paymentStatus: "PAID",
    reconciliationStatus: "MATCHED",
    invoiceStatus: "NOT_REQUIRED",
    source: "MANUAL",
    items: [],
  }), { userId: user.id, role: "STAFF" });

  await createFinanceTransaction(financeCreateSchema.parse({
    occurredAt: "2026-08-12",
    direction: "EXPENSE",
    amount: 250,
    categoryId: expenseCategory.id,
    counterparty: "MCP Finance Vendor",
    summary: "MCP Finance missing invoice expense",
    paymentStatus: "PAID",
    reconciliationStatus: "UNMATCHED",
    invoiceStatus: "MISSING",
    source: "MANUAL",
    items: [],
  }), { userId: user.id, role: "STAFF" });

  const readAuth = auth(user.id, ["finance:read"]);

  const summary = await callMcpTool("get_finance_summary", {
    start: "2026-08-01",
    end: "2026-08-31",
  }, readAuth) as McpResult<{
    period: { start: string; end: string };
    dashboard: {
      netRevenue: number;
      totalExpense: number;
      receivable: number;
      cashIncome: number;
      cashExpense: number;
      grossProfit: number;
      estimatedNetProfit: number;
      missingExpenseInvoices: number;
    };
  }>;
  assert.deepEqual(summary.structuredContent.period, { start: "2026-08-01", end: "2026-08-31" });
  assert.equal(summary.structuredContent.dashboard.netRevenue, 1500);
  assert.equal(summary.structuredContent.dashboard.totalExpense, 250);
  assert.equal(summary.structuredContent.dashboard.receivable, 1000);
  assert.equal(summary.structuredContent.dashboard.cashIncome, 500);
  assert.equal(summary.structuredContent.dashboard.cashExpense, 250);
  assert.equal(summary.structuredContent.dashboard.grossProfit, 1500);
  assert.equal(summary.structuredContent.dashboard.estimatedNetProfit, 1250);
  assert.equal(summary.structuredContent.dashboard.missingExpenseInvoices, 1);

  const transactions = await callMcpTool("list_finance_transactions", {
    start: "2026-08-01",
    end: "2026-08-31",
    query: "MCP Finance",
  }, readAuth) as McpResult<{
    total: number;
    transactions: Array<{ id: string; amount: number; summary: string | null }>;
  }>;
  assert.equal(transactions.structuredContent.total, 3);
  assert.equal(transactions.structuredContent.transactions.length, 3);

  const receivables = await callMcpTool("list_finance_receivables", {
    start: "2026-08-01",
    end: "2026-08-31",
  }, readAuth) as McpResult<{
    total: number;
    trackedReceivableAmount: number;
    receivables: Array<{ id: string; paymentStatus: string; amount: number }>;
  }>;
  assert.equal(receivables.structuredContent.total, 1);
  assert.equal(receivables.structuredContent.trackedReceivableAmount, 1000);
  assert.equal(receivables.structuredContent.receivables[0].id, pending.id);
  assert.equal(receivables.structuredContent.receivables[0].paymentStatus, "PENDING");

  const missingInvoices = await callMcpTool("list_missing_expense_invoices", {
    start: "2026-08-01",
    end: "2026-08-31",
  }, readAuth) as McpResult<{
    total: number;
    totalAmount: number;
    expenses: Array<{ amount: number; invoiceStatus: string }>;
  }>;
  assert.equal(missingInvoices.structuredContent.total, 1);
  assert.equal(missingInvoices.structuredContent.totalAmount, 250);
  assert.equal(missingInvoices.structuredContent.expenses[0].invoiceStatus, "MISSING");

  const detail = await callMcpTool("get_finance_transaction", { id: pending.id }, readAuth) as McpResult<{
    transaction: { id: string; amount: number | string; paymentStatus: string; sourceRef: string | null };
    billingSettlement: unknown;
    directSettlement: unknown;
  }>;
  assert.equal(detail.structuredContent.transaction.id, pending.id);
  assert.equal(Number(detail.structuredContent.transaction.amount), 1000);
  assert.equal(detail.structuredContent.transaction.paymentStatus, "PENDING");
  assert.equal(detail.structuredContent.billingSettlement, null);
  assert.equal(detail.structuredContent.directSettlement, null);

  const categories = await callMcpTool("list_finance_categories", {}, readAuth) as McpResult<{
    categories: Array<{ code: string; direction: string }>;
  }>;
  assert.ok(categories.structuredContent.categories.some((category) => category.code === incomeCode && category.direction === "INCOME"));
  assert.ok(categories.structuredContent.categories.some((category) => category.code === expenseCode && category.direction === "EXPENSE"));
});
