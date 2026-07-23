import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, requireApiUser } from "@/lib/auth";
import { runScheduledGoogleSheetSync } from "@/lib/google-sheet-sync";
import { processGoogleSheetMovementQueue } from "@/lib/google-sheet-movement-queue";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN"] });
    const run = await runScheduledGoogleSheetSync(undefined, auth.user.id);
    const movementQueue = await processGoogleSheetMovementQueue();
    return NextResponse.json({ ...run, movementQueue });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "自動同步測試失敗" }, { status: 503 });
  }
}
