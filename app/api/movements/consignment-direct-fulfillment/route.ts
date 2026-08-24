import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { consignmentDirectFulfillmentSchema, createConsignmentDirectFulfillment } from "@/lib/services/movements";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const parsed = consignmentDirectFulfillmentSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "請檢查商品、寄賣來源、直營通路、數量與售價" }, { status: 400 });
    const result = await createConsignmentDirectFulfillment(parsed.data, { userId: auth.user.id, role: auth.user.role, ipAddress: clientIp(request) });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "寄賣代發無法儲存" }, { status: 409 });
  }
}
