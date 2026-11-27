import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { deleteShipmentDraft, saveShipment, shipmentInputSchema } from "@/lib/services/shipments";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const parsed = shipmentInputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "請檢查出貨單資料" }, { status: 400 });
    const { id } = await context.params;
    return NextResponse.json(await saveShipment(parsed.data, { userId: auth.user.id, role: auth.user.role, ipAddress: clientIp(request) }, id));
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法儲存" }, { status: 409 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const { id } = await context.params;
    return NextResponse.json(await deleteShipmentDraft(id, { userId: auth.user.id, role: auth.user.role, ipAddress: clientIp(request) }));
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法刪除" }, { status: 409 });
  }
}
