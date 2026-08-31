import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { createFinanceTransaction, financeCreateSchema, listFinanceTransactions } from "@/lib/services/finance";

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const url = new URL(request.url);
    const direction = url.searchParams.get("direction");
    const rows = await listFinanceTransactions({
      start: url.searchParams.get("start") ?? undefined,
      end: url.searchParams.get("end") ?? undefined,
      direction: direction === "INCOME" || direction === "EXPENSE" ? direction : undefined,
      take: Number(url.searchParams.get("take") ?? 200),
    });
    return NextResponse.json(rows.map((row) => ({ ...row, amount: Number(row.amount) })));
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "讀取收支失敗" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const parsed = financeCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請檢查日期、收入/支出、金額與商品明細" }, { status: 400 });

    const input = parsed.data;
    const isSalesReturn = input.direction === "INCOME"
      && input.paymentStatus === "REFUNDED"
      && input.sourceRef?.startsWith("RETURN:");
    if (isSalesReturn && (!input.items.length || input.items.some((item) => !item.productId))) {
      return NextResponse.json({ error: "銷貨退回必須選擇退回商品" }, { status: 400 });
    }

    const result = await createFinanceTransaction(input, { userId: auth.user.id, role: auth.user.role, ipAddress: clientIp(request) });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "新增收支失敗" }, { status: 409 });
  }
}
