import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, requireApiUser } from "@/lib/auth";
import { applyGoogleSheetSyncRun } from "@/lib/google-sheet-sync";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN"] });
    const { id } = await context.params;
    const run = await applyGoogleSheetSyncRun(id, auth.user.id);
    return NextResponse.json(run);
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "同步無法套用" }, { status: 409 });
  }
}
