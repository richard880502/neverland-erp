import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { saveShipment, shipmentInputSchema } from "@/lib/services/shipments";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const parsed = shipmentInputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "請檢查出貨單資料" }, { status: 400 });
    const shipment = await saveShipment(parsed.data, { userId: auth.user.id, role: auth.user.role, ipAddress: clientIp(request) });
    return NextResponse.json(shipment, { status: 201 });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法儲存" }, { status: 409 });
  }
}
