import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, generateTemporaryPassword, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().email().max(200), role: z.enum(["ADMIN", "STAFF", "VIEWER"]) });
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const context = await requireApiUser({ roles: ["ADMIN"] }); const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請檢查姓名、信箱與角色" }, { status: 400 });
    const temporaryPassword = generateTemporaryPassword(); const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { ...parsed.data, email: parsed.data.email.toLowerCase(), passwordHash, mustChangePassword: true } });
      await tx.auditLog.create({ data: { userId: context.user.id, action: "USER_CREATED", entityType: "User", entityId: created.id, metadata: { role: created.role, email: created.email }, ipAddress: clientIp(request) } });
      return created;
    });
    return NextResponse.json({ user: { id: user.id, email: user.email }, temporaryPassword }, { status: 201 });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "這個電子郵件已經存在" }, { status: 409 });
    return NextResponse.json({ error: "使用者無法建立" }, { status: 500 });
  }
}
