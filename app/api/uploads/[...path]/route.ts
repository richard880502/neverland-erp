import path from "path";
import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { authErrorResponse, requireApiUser } from "@/lib/auth";
import { uploadRoot } from "@/lib/uploads";

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    await requireApiUser();
    const key = (await context.params).path.join("/");
    if (!/^products\/[a-f0-9-]+(?:-thumb)?\.webp$/.test(key)) {
      return NextResponse.json({ error: "檔案路徑無效" }, { status: 400 });
    }
    const root = uploadRoot();
    const filePath = path.resolve(/* turbopackIgnore: true */ root, key);
    if (!filePath.startsWith(`${root}${path.sep}`)) return NextResponse.json({ error: "檔案路徑無效" }, { status: 400 });
    const bytes = await readFile(filePath);
    return new Response(bytes, {
      headers: {
        "content-type": "image/webp",
        "cache-control": "private, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: "找不到圖片" }, { status: 404 });
  }
}
