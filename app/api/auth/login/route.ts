import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertSameOrigin, clientIp, createLoginChallenge, createSession } from "@/lib/auth";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(request: Request) {
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "請求來源無效" }, { status: 403 }); }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "請輸入正確的帳號與密碼" }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user) return NextResponse.json({ error: "帳號或密碼錯誤" }, { status: 401 });
  if (!user.active) return NextResponse.json({ error: "帳號已停用，請聯絡管理員" }, { status: 403 });
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
    return NextResponse.json({ error: `登入嘗試過多，請在 ${minutes} 分鐘後重試` }, { status: 429 });
  }
  if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    const failedLoginCount = user.failedLoginCount + 1;
    const lockedUntil = failedLoginCount >= 5 ? new Date(Date.now() + 15 * 60_000) : null;
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: lockedUntil ? 0 : failedLoginCount, lockedUntil } }),
      prisma.auditLog.create({ data: { userId: user.id, action: "LOGIN_FAILED", entityType: "User", entityId: user.id, ipAddress: clientIp(request) } }),
    ]);
    return NextResponse.json({ error: "帳號或密碼錯誤" }, { status: 401 });
  }
  if (user.totpEnabledAt && user.totpSecretEncrypted) {
    await createLoginChallenge(user.id, request);
    await prisma.auditLog.create({ data: {
      userId: user.id, action: "LOGIN_PASSWORD_VERIFIED", entityType: "User", entityId: user.id,
      metadata: { requiresTwoFactor: true }, ipAddress: clientIp(request),
    } });
    return NextResponse.json({ ok: true, requiresTwoFactor: true });
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } }),
    prisma.auditLog.create({ data: { userId: user.id, action: "LOGIN_SUCCESS", entityType: "User", entityId: user.id, ipAddress: clientIp(request) } }),
  ]);
  await createSession(user.id, request);
  return NextResponse.json({ ok: true, requiresTwoFactor: false, mustChangePassword: user.mustChangePassword });
}
