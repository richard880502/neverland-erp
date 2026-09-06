import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, requireApiUser } from "@/lib/auth";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    await requireApiUser({ roles: ["ADMIN"] });
    await context.params;
    return NextResponse.json({ error: "商品主檔已改為 ERP 單向同步，無法從 Google Sheet 套用主檔資料。" }, { status: 410 });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "同步無法套用" }, { status: 409 });
  }
}
