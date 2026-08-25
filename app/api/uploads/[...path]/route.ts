import { NextResponse } from "next/server";
import { authErrorResponse, requireApiUser } from "@/lib/auth";
import { isProductImageKey, objectStorage, signedReadUrlTtl } from "@/lib/object-storage";

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    await requireApiUser();
    const key = (await context.params).path.join("/");
    if (!isProductImageKey(key)) {
      return NextResponse.json({ error: "檔案路徑無效" }, { status: 400 });
    }
    const storage = objectStorage();
    const url = await storage.getSignedReadUrl(key);
    return NextResponse.redirect(url, {
      status: 302,
      headers: {
        "cache-control": `private, max-age=${Math.max(0, signedReadUrlTtl() - 60)}`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: "找不到圖片" }, { status: 404 });
  }
}
