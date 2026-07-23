import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { assertSameOrigin, authErrorResponse, clientIp, generateTemporaryPassword, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const auth = await requireApiUser({ roles: ["ADMIN"] }); const { id } = await context.params;
    const target = await prisma.user.findUnique({ where: { id } }); if (!target) return NextResponse.json({ error: "找不到使用者" }, { status: 404 });
    const temporaryPassword = generateTemporaryPassword(); const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } }),
      prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.auditLog.create({ data: { userId: auth.user.id, action: "PASSWORD_RESET", entityType: "User", entityId: id, ipAddress: clientIp(request) } }),
    ]);
    return NextResponse.json({ temporaryPassword });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: "密碼無法重設" }, { status: 500 });
  }
}
