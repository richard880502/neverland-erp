import { NextResponse } from "next/server";
import { assertSameOrigin, clearSession } from "@/lib/auth";

export async function POST(request: Request) {
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "請求來源無效" }, { status: 403 }); }
  await clearSession();
  return new NextResponse(null, {
    status: 303,
    headers: { Location: "/login" },
  });
}
