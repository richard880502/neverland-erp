import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, requireApiUser } from "@/lib/auth";
import { processGoogleSheetMovementQueue } from "@/lib/google-sheet-movement-queue";
import { enqueueGoogleSheetProductBackfill, processGoogleSheetProductQueue, retryGoogleSheetProductQueue } from "@/lib/google-sheet-product-queue";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireApiUser({ roles: ["ADMIN"] });
    const [backfilledProducts, retriedProducts] = await Promise.all([
      enqueueGoogleSheetProductBackfill(),
      retryGoogleSheetProductQueue(),
    ]);
    const [productQueue, movementQueue] = await Promise.all([
      processGoogleSheetProductQueue(),
      processGoogleSheetMovementQueue(),
    ]);
    return NextResponse.json({ productQueue: { ...productQueue, backfilledProducts, retriedProducts: retriedProducts.count }, movementQueue });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "自動同步測試失敗" }, { status: 503 });
  }
}
