import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const auth = await requireApiUser({ roles: ["ADMIN"] }); const { id } = await context.params;
    const target = await prisma.user.findUnique({ where: { id } }); if (!target) return NextResponse.json({ error: "找不到使用者" }, { status: 404 });
    const result = await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await prisma.auditLog.create({ data: { userId: auth.user.id, action: "SESSIONS_REVOKED", entityType: "User", entityId: id, metadata: { count: result.count }, ipAddress: clientIp(request) } });
    return NextResponse.json({ revoked: result.count });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: "登入裝置無法撤銷" }, { status: 500 });
  }
}
