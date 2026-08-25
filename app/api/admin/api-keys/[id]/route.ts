import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN"] });
    const { id } = await context.params;

    const apiKey = await prisma.apiKey.findUnique({ where: { id } });
    if (!apiKey) return NextResponse.json({ error: "找不到這把 API Key" }, { status: 404 });

    if (!apiKey.revokedAt) {
      await prisma.$transaction([
        prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date(), active: false } }),
        prisma.auditLog.create({ data: { userId: auth.user.id, action: "API_KEY_REVOKED", entityType: "ApiKey", entityId: id } }),
      ]);
    }

    return NextResponse.json({ ok: true });
  } catch (cause) {
    const error = authErrorResponse(cause);
    return NextResponse.json({ error: error?.error ?? "無法撤銷 API Key" }, { status: error?.status ?? 500 });
  }
}
