import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { freightInputSchema, updateShipmentFreight } from "@/lib/services/shipments";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const parsed = freightInputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "請檢查運費金額" }, { status: 400 });
    const { id } = await context.params;
    return NextResponse.json(await updateShipmentFreight(id, parsed.data, { userId: auth.user.id, role: auth.user.role, ipAddress: clientIp(request) }));
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法更新運費" }, { status: 409 });
  }
}
