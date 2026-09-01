import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { voidDirectSettlement } from "@/lib/services/direct-settlements";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const body = await request.json().catch(() => null) as { action?: string } | null;
    if (body?.action !== "VOID") return NextResponse.json({ error: "不支援的直營結算操作" }, { status: 400 });
    const { id } = await context.params;
    const settlement = await voidDirectSettlement(id, { userId: auth.user.id, role: auth.user.role, ipAddress: clientIp(request) });
    return NextResponse.json({ id: settlement.id, status: settlement.status });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "直營結算更新失敗" }, { status: 409 });
  }
}
