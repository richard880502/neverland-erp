import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptTotpSecret, generateRecoveryCodes, hashRecoveryCode, verifyTotpCode } from "@/lib/two-factor";

const schema = z.object({ code: z.string().trim().regex(/^\d{6}$/) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請輸入 Google Authenticator 顯示的 6 位驗證碼" }, { status: 400 });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (user.totpEnabledAt) return NextResponse.json({ error: "雙重驗證已經啟用" }, { status: 409 });
    if (!user.totpSecretEncrypted) return NextResponse.json({ error: "請先掃描 QR Code 開始設定" }, { status: 400 });
    const timeStep = await verifyTotpCode(decryptTotpSecret(user.totpSecretEncrypted), parsed.data.code);
    if (timeStep == null) return NextResponse.json({ error: "驗證碼不正確，請確認手機時間後再試一次" }, { status: 400 });

    const recoveryCodes = generateRecoveryCodes();
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { totpEnabledAt: now, totpLastUsedStep: timeStep } });
      await tx.totpRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.totpRecoveryCode.createMany({ data: recoveryCodes.map((code) => ({ userId: user.id, codeHash: hashRecoveryCode(code) })) });
      await tx.session.updateMany({ where: { userId: user.id, id: { not: auth.sessionId }, revokedAt: null }, data: { revokedAt: now } });
      await tx.auditLog.create({ data: { userId: user.id, action: "TOTP_ENABLED", entityType: "User", entityId: user.id, metadata: { recoveryCodeCount: recoveryCodes.length }, ipAddress: clientIp(request) } });
    });
    return NextResponse.json({ ok: true, recoveryCodes });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: "無法啟用雙重驗證" }, { status: 500 });
  }
}
