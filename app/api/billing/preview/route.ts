import { NextResponse } from "next/server";
import { authErrorResponse, requireApiUser } from "@/lib/auth";
import { billingPreviewSchema, previewBillingStatement } from "@/lib/services/billing";

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const url = new URL(request.url);
    const parsed = billingPreviewSchema.safeParse({
      channelId: url.searchParams.get("channelId"),
      periodStart: url.searchParams.get("periodStart"),
      periodEnd: url.searchParams.get("periodEnd"),
    });
    if (!parsed.success) return NextResponse.json({ error: "請檢查客戶與請款期間" }, { status: 400 });
    return NextResponse.json(await previewBillingStatement(parsed.data));
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "自動帶入請款品項失敗" }, { status: 409 });
  }
}
