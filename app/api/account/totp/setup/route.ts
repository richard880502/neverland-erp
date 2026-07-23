import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createTotpEnrollment, encryptTotpSecret } from "@/lib/two-factor";

const schema = z.object({ currentPassword: z.string().min(1) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請輸入目前密碼" }, { status: 400 });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) return NextResponse.json({ error: "目前密碼不正確" }, { status: 400 });
    if (user.totpEnabledAt) return NextResponse.json({ error: "雙重驗證已經啟用" }, { status: 409 });

    const enrollment = createTotpEnrollment(user.email);
    const qrDataUrl = await QRCode.toDataURL(enrollment.uri, { width: 260, margin: 1, errorCorrectionLevel: "M", color: { dark: "#171816", light: "#ffffff" } });
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { totpSecretEncrypted: encryptTotpSecret(enrollment.secret), totpEnabledAt: null, totpLastUsedStep: null } }),
      prisma.totpRecoveryCode.deleteMany({ where: { userId: user.id } }),
      prisma.auditLog.create({ data: { userId: user.id, action: "TOTP_SETUP_STARTED", entityType: "User", entityId: user.id, ipAddress: clientIp(request) } }),
    ]);
    return NextResponse.json({ qrDataUrl, manualKey: enrollment.secret });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    if (error instanceof Error && error.message.startsWith("TOTP_ENCRYPTION_KEY")) return NextResponse.json({ error: "伺服器尚未設定雙重驗證加密金鑰" }, { status: 503 });
    return NextResponse.json({ error: "無法開始設定雙重驗證" }, { status: 500 });
  }
}
