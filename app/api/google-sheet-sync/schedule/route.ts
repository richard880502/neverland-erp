import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, requireApiUser } from "@/lib/auth";
import { saveGoogleSheetSchedule } from "@/lib/google-sheet-source";

const schema = z.object({
  automaticSyncEnabled: z.boolean(),
  syncTimeZone: z.string().trim().min(1).max(100),
  syncHour: z.coerce.number().int().min(0).max(23),
  syncMinute: z.coerce.number().int().min(0).max(59),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN"] });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請檢查定時同步時間與時區" }, { status: 400 });
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: parsed.data.syncTimeZone }).format();
    } catch {
      return NextResponse.json({ error: "請輸入有效的 IANA 時區，例如 Asia/Taipei" }, { status: 400 });
    }
    const setting = await saveGoogleSheetSchedule({ ...parsed.data, updatedById: auth.user.id });
    return NextResponse.json({
      automaticSyncEnabled: setting.automaticSyncEnabled,
      syncTimeZone: setting.syncTimeZone,
      syncHour: setting.syncHour,
      syncMinute: setting.syncMinute,
    });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法儲存定時同步設定" }, { status: 400 });
  }
}
