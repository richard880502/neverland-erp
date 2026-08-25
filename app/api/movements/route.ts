import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { createInventoryMovement, movementInputSchema } from "@/lib/services/movements";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] }); const parsed = movementInputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "請檢查日期、商品與數量" }, { status: 400 });
    const movement = await createInventoryMovement(parsed.data, { userId: auth.user.id, role: auth.user.role, ipAddress: clientIp(request) });
    return NextResponse.json(movement, { status: 201 });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "異動無法儲存" }, { status: 409 });
  }
}
