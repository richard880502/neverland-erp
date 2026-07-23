import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptTotpSecret, hashRecoveryCode, looksLikeRecoveryCode, verifyTotpCode } from "@/lib/two-factor";

const schema = z.object({ currentPassword: z.string().min(1), code: z.string().trim().min(6).max(40) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請輸入目前密碼與驗證碼" }, { status: 400 });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) return NextResponse.json({ error: "目前密碼不正確" }, { status: 400 });
    if (!user.totpEnabledAt || !user.totpSecretEncrypted) return NextResponse.json({ error: "尚未啟用雙重驗證" }, { status: 400 });

    const recoveryHash = looksLikeRecoveryCode(parsed.data.code) ? hashRecoveryCode(parsed.data.code) : null;
    const existingRecovery = recoveryHash ? await prisma.totpRecoveryCode.findUnique({ where: { userId_codeHash: { userId: user.id, codeHash: recoveryHash } } }) : null;
    const timeStep = recoveryHash ? null : await verifyTotpCode(decryptTotpSecret(user.totpSecretEncrypted), parsed.data.code, user.totpLastUsedStep);
    if (recoveryHash ? !existingRecovery || existingRecovery.usedAt : timeStep == null) return NextResponse.json({ error: "驗證碼或備援碼不正確" }, { status: 400 });

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      if (existingRecovery) {
        const consumed = await tx.totpRecoveryCode.updateMany({ where: { id: existingRecovery.id, usedAt: null }, data: { usedAt: now } });
        if (consumed.count !== 1) throw new Error("RECOVERY_CODE_ALREADY_USED");
        await tx.user.update({ where: { id: user.id }, data: { totpSecretEncrypted: null, totpEnabledAt: null, totpLastUsedStep: null } });
      } else if (timeStep != null) {
        const disabled = await tx.user.updateMany({
          where: { id: user.id, OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: timeStep } }] },
          data: { totpSecretEncrypted: null, totpEnabledAt: null, totpLastUsedStep: null },
        });
        if (disabled.count !== 1) throw new Error("TOTP_ALREADY_USED");
      }
      await tx.totpRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.loginChallenge.deleteMany({ where: { userId: user.id } });
      await tx.session.updateMany({ where: { userId: user.id, id: { not: auth.sessionId }, revokedAt: null }, data: { revokedAt: now } });
      await tx.auditLog.create({ data: { userId: user.id, action: "TOTP_DISABLED", entityType: "User", entityId: user.id, ipAddress: clientIp(request) } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: "無法停用雙重驗證" }, { status: 500 });
  }
}
