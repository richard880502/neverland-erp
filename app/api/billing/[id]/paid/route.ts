import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { markBillingPaidSchema, markBillingStatementPaid } from "@/lib/services/billing";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const parsed = markBillingPaidSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請檢查收款日期與金額" }, { status: 400 });
    const { id } = await context.params;
    const statement = await markBillingStatementPaid(id, parsed.data, { userId: auth.user.id, role: auth.user.role, ipAddress: clientIp(request) });
    return NextResponse.json({ ok: true, status: statement.status });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "收款登記失敗" }, { status: 409 });
  }
}
