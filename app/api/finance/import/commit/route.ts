import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createFinanceTransaction, financeCreateSchema, listFinanceCategories } from "@/lib/services/finance";

const importRowSchema = z.object({
  sheetName: z.string().min(1).max(200),
  rowNumber: z.number().int().min(1),
  status: z.enum(["READY", "REVIEW"]),
  normalized: z.object({
    occurredAt: z.string().nullable(),
    direction: z.enum(["INCOME", "EXPENSE"]).nullable(),
    amount: z.number().nullable(),
    categoryCode: z.string().nullable(),
    counterparty: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    items: z.array(z.object({ productName: z.string(), size: z.string().nullable().optional(), quantity: z.number(), lineAmount: z.number() })).default([]),
  }),
});

const requestSchema = z.object({ rows: z.array(importRowSchema).min(1).max(1000) });
const norm = (value: string | null | undefined) => (value ?? "").trim().toLocaleLowerCase("zh-Hant").replace(/\s+/g, " ");

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const body = requestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: "匯入資料格式不正確" }, { status: 400 });

    const [categories, products] = await Promise.all([
      listFinanceCategories(),
      prisma.product.findMany({ select: { id: true, sku: true, name: true, size: true } }),
    ]);
    const categoryByCode = new Map(categories.map((category) => [category.code, category.id]));
    const productByNameSize = new Map<string, typeof products>();
    for (const product of products) {
      const key = `${norm(product.name)}|${norm(product.size)}`;
      productByNameSize.set(key, [...(productByNameSize.get(key) ?? []), product]);
    }

    const result = { imported: 0, skipped: 0, productLinks: 0, errors: [] as Array<{ sheetName: string; rowNumber: number; error: string }> };
    for (const row of body.data.rows) {
      if (row.status !== "READY") { result.skipped += 1; continue; }
      const n = row.normalized;
      const mappedItems = n.items.map((item) => {
        const exact = productByNameSize.get(`${norm(item.productName)}|${norm(item.size)}`) ?? [];
        const product = exact.length === 1 ? exact[0] : null;
        if (product) result.productLinks += 1;
        return { ...item, productId: product?.id ?? null, sku: product?.sku ?? null, size: item.size ?? product?.size ?? null };
      });
      const parsed = financeCreateSchema.safeParse({
        occurredAt: n.occurredAt,
        direction: n.direction,
        amount: n.amount,
        categoryId: n.categoryCode ? categoryByCode.get(n.categoryCode) ?? null : null,
        counterparty: n.counterparty ?? null,
        note: n.note ?? null,
        source: "EXCEL",
        legacySheet: row.sheetName,
        legacyRow: row.rowNumber,
        paymentStatus: "PAID",
        reconciliationStatus: "UNMATCHED",
        invoiceStatus: "MISSING",
        items: mappedItems,
      });
      if (!parsed.success) {
        result.errors.push({ sheetName: row.sheetName, rowNumber: row.rowNumber, error: "正規化資料驗證失敗" });
        continue;
      }
      try {
        await createFinanceTransaction(parsed.data, { userId: auth.user.id, role: auth.user.role, ipAddress: clientIp(request) });
        result.imported += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "匯入失敗";
        if (message.includes("unique") || message.includes("Unique") || message.includes("legacySheet")) result.skipped += 1;
        else result.errors.push({ sheetName: row.sheetName, rowNumber: row.rowNumber, error: message });
      }
    }
    return NextResponse.json(result, { status: result.errors.length ? 207 : 200 });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "匯入失敗" }, { status: 500 });
  }
}
