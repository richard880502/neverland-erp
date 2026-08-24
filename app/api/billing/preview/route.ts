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
      settlementRate: url.searchParams.get("settlementRate"),
      taxRate: url.searchParams.get("taxRate"),
      shippingFee: url.searchParams.get("shippingFee") ?? 0,
    });
    if (!parsed.success) return NextResponse.json({ error: "請檢查客戶、期間與結算設定" }, { status: 400 });
    return NextResponse.json(await previewBillingStatement(parsed.data));
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "請款預覽失敗" }, { status: 409 });
  }
}
