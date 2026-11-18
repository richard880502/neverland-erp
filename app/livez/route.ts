import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness verifies that the HTTP process can respond.
 * Deliberately avoid database, object storage, or third-party calls:
 * transient dependency outages should affect readiness, not liveness.
 */
export function GET() {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
