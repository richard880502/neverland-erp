import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, requireApiUser } from "@/lib/auth";
import { openBillingGoogleSheet } from "@/lib/billing-google-sheet";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const { id } = await context.params;
    const result = await openBillingGoogleSheet(id, auth.user.id);
    return NextResponse.json(result);
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Google 請款單建立失敗" }, { status: 500 });
  }
}
