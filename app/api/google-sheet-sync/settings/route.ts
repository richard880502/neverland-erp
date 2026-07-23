import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, requireApiUser } from "@/lib/auth";
import {
  parseGoogleSheetReference,
  readGoogleSheetWorkbook,
  saveGoogleSheetConnection,
} from "@/lib/google-sheet-source";

const schema = z.object({
  sheetReference: z.string().trim().min(1).max(500),
  action: z.enum(["TEST", "SAVE"]),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN"] });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請輸入有效的 Google Sheet 網址或 ID" }, { status: 400 });

    const spreadsheetId = parseGoogleSheetReference(parsed.data.sheetReference);
    const workbook = await readGoogleSheetWorkbook(spreadsheetId);
    const result = {
      spreadsheetId,
      spreadsheetTitle: workbook.title,
      source: workbook.source,
      fetchedAt: workbook.fetchedAt,
      sheets: Object.keys(workbook.sheets),
    };
    if (parsed.data.action === "TEST") return NextResponse.json(result);

    const connection = await saveGoogleSheetConnection({
      spreadsheetId,
      spreadsheetTitle: workbook.title,
      lastTestedAt: new Date(),
      lastTestStatus: "SUCCESS",
      lastTestSource: workbook.source,
      lastTestError: null,
      updatedById: auth.user.id,
    });
    return NextResponse.json({
      ...result,
      saved: true,
      updatedAt: connection.updatedAt.toISOString(),
    });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Google Sheet 連線設定失敗" }, { status: 400 });
  }
}
