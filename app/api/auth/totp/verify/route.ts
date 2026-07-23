import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, clearLoginChallenge, clientIp, createSession, getLoginChallenge } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptTotpSecret, hashRecoveryCode, looksLikeRecoveryCode, verifyTotpCode } from "@/lib/two-factor";

const schema = z.object({ code: z.string().trim().min(6).max(40) });

export async function POST(request: Request) {
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "請求來源無效" }, { status: 403 }); }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "請輸入驗證碼或備援碼" }, { status: 400 });

  const challenge = await getLoginChallenge();
  const now = new Date();
  if (!challenge || challenge.usedAt || challenge.expiresAt <= now || challenge.attempts >= 5) {
    await clearLoginChallenge(false);
    return NextResponse.json({ error: "驗證已逾時，請重新輸入帳號與密碼", restart: true }, { status: 401 });
  }
  const user = challenge.user;
  if (!user.active || !user.totpEnabledAt || !user.totpSecretEncrypted) {
    await clearLoginChallenge();
    return NextResponse.json({ error: "帳號或雙重驗證狀態已變更，請重新登入", restart: true }, { status: 401 });
  }
  if (user.lockedUntil && user.lockedUntil > now) {
    await clearLoginChallenge();
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
    return NextResponse.json({ error: `登入嘗試過多，請在 ${minutes} 分鐘後重試`, restart: true }, { status: 429 });
  }

  const isRecoveryCode = looksLikeRecoveryCode(parsed.data.code);
  const recoveryCodeHash = isRecoveryCode ? hashRecoveryCode(parsed.data.code) : null;
  const recoveryCode = recoveryCodeHash ? await prisma.totpRecoveryCode.findUnique({ where: { userId_codeHash: { userId: user.id, codeHash: recoveryCodeHash } } }) : null;
  const timeStep = isRecoveryCode ? null : await verifyTotpCode(decryptTotpSecret(user.totpSecretEncrypted), parsed.data.code, user.totpLastUsedStep);
  const factorValid = isRecoveryCode ? Boolean(recoveryCode && !recoveryCode.usedAt) : timeStep != null;

  if (!factorValid) {
    const attempts = challenge.attempts + 1;
    const failedLoginCount = user.failedLoginCount + 1;
    const lockedUntil = failedLoginCount >= 5 ? new Date(Date.now() + 15 * 60_000) : null;
    await prisma.$transaction([
      prisma.loginChallenge.update({ where: { id: challenge.id }, data: { attempts, usedAt: attempts >= 5 ? now : null } }),
      prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: lockedUntil ? 0 : failedLoginCount, lockedUntil } }),
      prisma.auditLog.create({ data: {
        userId: user.id, action: "LOGIN_FAILED", entityType: "User", entityId: user.id,
        metadata: { stage: "two_factor", attempts }, ipAddress: clientIp(request),
      } }),
    ]);
    if (attempts >= 5 || lockedUntil) await clearLoginChallenge(false);
    return NextResponse.json({
      error: lockedUntil ? "登入嘗試過多，帳號已暫時鎖定 15 分鐘" : `驗證碼不正確，還可嘗試 ${5 - attempts} 次`,
      restart: attempts >= 5 || Boolean(lockedUntil),
    }, { status: lockedUntil ? 429 : 401 });
  }

  await prisma.$transaction(async (tx) => {
    const consumedChallenge = await tx.loginChallenge.updateMany({ where: { id: challenge.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (consumedChallenge.count !== 1) throw new Error("CHALLENGE_ALREADY_USED");
    if (recoveryCode) {
      const consumedCode = await tx.totpRecoveryCode.updateMany({ where: { id: recoveryCode.id, usedAt: null }, data: { usedAt: now } });
      if (consumedCode.count !== 1) throw new Error("RECOVERY_CODE_ALREADY_USED");
    } else if (timeStep != null) {
      const consumedStep = await tx.user.updateMany({
        where: { id: user.id, OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: timeStep } }] },
        data: { totpLastUsedStep: timeStep },
      });
      if (consumedStep.count !== 1) throw new Error("TOTP_ALREADY_USED");
    }
    await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
    await tx.auditLog.create({ data: {
      userId: user.id, action: "LOGIN_SUCCESS", entityType: "User", entityId: user.id,
      metadata: { secondFactor: recoveryCode ? "recovery_code" : "totp" }, ipAddress: clientIp(request),
    } });
  });
  await createSession(user.id, request);
  return NextResponse.json({ ok: true, mustChangePassword: user.mustChangePassword, usedRecoveryCode: Boolean(recoveryCode) });
}

export async function DELETE(request: Request) {
  try { assertSameOrigin(request); } catch { return NextResponse.json({ error: "請求來源無效" }, { status: 403 }); }
  await clearLoginChallenge();
  return NextResponse.json({ ok: true });
}
