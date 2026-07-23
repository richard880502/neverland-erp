import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, requireApiUser } from "@/lib/auth";
import { createManualSyncPreview } from "@/lib/google-sheet-sync";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN"] });
    const run = await createManualSyncPreview(auth.user.id);
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "無法讀取 Google Sheet" }, { status: 503 });
  }
}
