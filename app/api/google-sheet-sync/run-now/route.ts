import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, requireApiUser } from "@/lib/auth";
import { processGoogleSheetMovementQueue } from "@/lib/google-sheet-movement-queue";
import { enqueueGoogleSheetProductBackfill } from "@/lib/google-sheet-product-queue";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN"] });
    const backfilledProducts = await enqueueGoogleSheetProductBackfill();
    const movementQueue = await processGoogleSheetMovementQueue();
    return NextResponse.json({ backfilledProducts, productQueue: movementQueue.productQueue, movementQueue });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "自動同步測試失敗" }, { status: 503 });
  }
}
