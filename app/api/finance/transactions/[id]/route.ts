import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBillingFinanceTrace } from "@/lib/services/billing-finance-trace";
import { getDirectSettlementFinanceTrace } from "@/lib/services/direct-settlement-finance-trace";
import { financeUpdateSchema, getFinanceTransactionDetail, updateFinanceTransaction } from "@/lib/services/finance";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiUser({ roles: ["ADMIN", "STAFF", "VIEWER"] });
    const { id } = await context.params;
    const result = await getFinanceTransactionDetail(id);
    if (!result) return NextResponse.json({ error: "找不到收支紀錄" }, { status: 404 });
    const [billingSettlement, directSettlement] = await Promise.all([
      getBillingFinanceTrace(result.sourceRef),
      getDirectSettlementFinanceTrace(result.sourceRef),
    ]);
    return NextResponse.json({ ...result, billingSettlement, directSettlement });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "讀取收支失敗" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const { id } = await context.params;
    const parsed = financeUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請檢查財務狀態、分類與發票資料" }, { status: 400 });

    if (parsed.data.paymentStatus === "VOID") {
      const current = await prisma.financeTransaction.findUnique({ where: { id }, select: { sourceRef: true } });
      if (current?.sourceRef?.startsWith("BILLING:")) {
        return NextResponse.json({ error: "這筆收支由請款結算產生，請到請款 / 結算管理作廢，系統會一併釋放來源銷貨。" }, { status: 409 });
      }
      if (current?.sourceRef?.startsWith("DIRECT_SETTLEMENT:") || current?.sourceRef?.startsWith("RETURN:DIRECT_SETTLEMENT:")) {
        return NextResponse.json({ error: "這筆收支由直營撥款結算產生，請到結算 / 請款管理作廢該批次，系統會一併釋放來源銷售。" }, { status: 409 });
      }
    }

    const result = await updateFinanceTransaction(id, parsed.data, { userId: auth.user.id, role: auth.user.role, ipAddress: clientIp(request) });
    return NextResponse.json(result);
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新收支失敗" }, { status: 409 });
  }
}
