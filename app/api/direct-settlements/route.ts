import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { createDirectSettlement, directSettlementCreateSchema } from "@/lib/services/direct-settlements";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const parsed = directSettlementCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請檢查直營結算期間、費用與實際撥款" }, { status: 400 });
    const settlement = await createDirectSettlement(parsed.data, { userId: auth.user.id, role: auth.user.role, ipAddress: clientIp(request) });
    return NextResponse.json({ id: settlement.id, settlementNo: settlement.settlementNo }, { status: 201 });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "直營結算建立失敗" }, { status: 409 });
  }
}
