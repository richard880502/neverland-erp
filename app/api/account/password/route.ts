import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser, validatePassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const context = await requireApiUser({ allowPasswordChange: true });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請填寫目前密碼與新密碼" }, { status: 400 });
    const policyError = validatePassword(parsed.data.newPassword);
    if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: context.user.id } });
    if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) return NextResponse.json({ error: "目前密碼不正確" }, { status: 400 });
    if (await bcrypt.compare(parsed.data.newPassword, user.passwordHash)) return NextResponse.json({ error: "新密碼不可與目前密碼相同" }, { status: 400 });
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } }),
      prisma.session.updateMany({ where: { userId: user.id, id: { not: context.sessionId }, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.auditLog.create({ data: { userId: user.id, action: "PASSWORD_CHANGED", entityType: "User", entityId: user.id, ipAddress: clientIp(request) } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: "密碼變更失敗" }, { status: 500 });
  }
}
