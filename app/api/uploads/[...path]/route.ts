import { NextResponse } from "next/server";
import { authErrorResponse, requireApiUser } from "@/lib/auth";
import { isProductImageKey, objectStorage } from "@/lib/object-storage";

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    await requireApiUser();
    const key = (await context.params).path.join("/");
    if (!isProductImageKey(key)) {
      return NextResponse.json({ error: "檔案路徑無效" }, { status: 400 });
    }
    const object = await objectStorage().get(key);
    if (!object) return NextResponse.json({ error: "找不到圖片" }, { status: 404 });
    const headers: Record<string, string> = {
      "content-type": object.contentType ?? "image/webp",
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    };
    if (object.size !== undefined) headers["content-length"] = String(object.size);
    return new Response(object.body, { headers });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: "找不到圖片" }, { status: 404 });
  }
}
