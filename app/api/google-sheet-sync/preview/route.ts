import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, requireApiUser } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireApiUser({ roles: ["ADMIN"] });
    return NextResponse.json({ error: "商品主檔已改為 ERP 單向同步；請在 ERP 維護商品後使用「馬上同步」。" }, { status: 410 });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法讀取 Google Sheet" }, { status: 503 });
  }
}
