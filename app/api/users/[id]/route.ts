import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ name: z.string().trim().min(1).max(100).optional(), role: z.enum(["ADMIN", "STAFF", "VIEWER"]).optional(), active: z.boolean().optional() });
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const auth = await requireApiUser({ roles: ["ADMIN"] }); const { id } = await context.params; const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || Object.keys(parsed.data).length === 0) return NextResponse.json({ error: "沒有可更新的欄位" }, { status: 400 });
    const target = await prisma.user.findUnique({ where: { id } }); if (!target) return NextResponse.json({ error: "找不到使用者" }, { status: 404 });
    if (id === auth.user.id && (parsed.data.active === false || (parsed.data.role && parsed.data.role !== "ADMIN"))) return NextResponse.json({ error: "不能停用目前帳號或移除自己的管理員權限" }, { status: 400 });
    if (target.role === "ADMIN" && (parsed.data.active === false || (parsed.data.role && parsed.data.role !== "ADMIN"))) {
      const adminCount = await prisma.user.count({ where: { role: "ADMIN", active: true } }); if (adminCount <= 1) return NextResponse.json({ error: "系統至少需要一位啟用中的管理員" }, { status: 400 });
    }
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: parsed.data });
      if (parsed.data.active === false) await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      const action = parsed.data.active === false ? "USER_DISABLED" : parsed.data.active === true ? "USER_ENABLED" : parsed.data.name !== undefined && parsed.data.role === undefined ? "USER_NAME_UPDATED" : "USER_UPDATED";
      await tx.auditLog.create({ data: { userId: auth.user.id, action, entityType: "User", entityId: id, metadata: { beforeName: target.name, afterName: updated.name, beforeRole: target.role, afterRole: updated.role, active: updated.active }, ipAddress: clientIp(request) } });
      return updated;
    });
    return NextResponse.json({ id: user.id, name: user.name, active: user.active, role: user.role });
  } catch (error) {
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: "使用者無法更新" }, { status: 500 });
  }
}
