import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/auth";
import { requireApiKey } from "@/lib/api-key-auth";

export async function GET(request: Request) {
  try {
    await requireApiKey(request);
    return NextResponse.json({ ok: true, timestamp: new Date().toISOString() });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "連線檢查失敗" }, { status: 409 });
  }
}
