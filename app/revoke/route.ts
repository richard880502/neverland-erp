import { NextResponse } from "next/server";
import { requireHttpsInProduction, revokeToken } from "@/lib/mcp/oauth";
import { takeRateLimit } from "@/lib/mcp/rate-limit";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try { requireHttpsInProduction(request); const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"; if (!takeRateLimit(`revoke:${ip}`, 30).allowed) return new NextResponse(null, { status: 429 }); const token = (await request.formData()).get("token"); if (typeof token === "string") await revokeToken(token); return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } }); }
  catch { return new NextResponse(null, { status: 400 }); }
}
