import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, requireApiUser } from "@/lib/auth";
import { createApiKey } from "@/lib/api-key";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  label: z.string().trim().min(1).max(120),
});

export async function GET() {
  try {
    await requireApiUser({ roles: ["ADMIN"] });
    const apiKeys = await prisma.apiKey.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, active: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    });
    return NextResponse.json(apiKeys);
  } catch (cause) {
    const error = authErrorResponse(cause);
    return NextResponse.json({ error: error?.error ?? "無法取得 API Key 列表" }, { status: error?.status ?? 500 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN"] });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "請輸入有效的 label" }, { status: 400 });

    const apiKey = await createApiKey(parsed.data.label);
    await prisma.auditLog.create({
      data: { userId: auth.user.id, action: "API_KEY_CREATED", entityType: "ApiKey", entityId: apiKey.id, metadata: { label: apiKey.label } },
    });

    return NextResponse.json(apiKey, { status: 201 });
  } catch (cause) {
    const error = authErrorResponse(cause);
    return NextResponse.json({ error: error?.error ?? "無法建立 API Key" }, { status: error?.status ?? 500 });
  }
}
