import { NextResponse } from "next/server";
import { authErrorResponse, requireApiUser } from "@/lib/auth";
import { directSettlementPreviewSchema, previewDirectSettlement } from "@/lib/services/direct-settlements";

export async function GET(request: Request) {
  try {
    await requireApiUser({ roles: ["ADMIN", "STAFF", "VIEWER"] });
    const url = new URL(request.url);
    const parsed = directSettlementPreviewSchema.safeParse({
      channelId: url.searchParams.get("channelId"),
      periodStart: url.searchParams.get("periodStart"),
      periodEnd: url.searchParams.get("periodEnd"),
    });
    if (!parsed.success) return NextResponse.json({ error: "請檢查直營通路與結算期間" }, { status: 400 });
    return NextResponse.json(await previewDirectSettlement(parsed.data));
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "直營待結算資料讀取失敗" }, { status: 409 });
  }
}
