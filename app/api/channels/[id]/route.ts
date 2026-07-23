import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({ active: z.boolean() }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請提供正確的通路狀態" }, { status: 400 });
    const { id } = await context.params;
    const existing = await prisma.channel.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!existing) return NextResponse.json({ error: "找不到通路" }, { status: 404 });

    const channel = await prisma.$transaction(async (tx) => {
      const updated = await tx.channel.update({ where: { id }, data: { active: parsed.data.active } });
      await tx.auditLog.create({
        data: {
          userId: auth.user.id,
          action: parsed.data.active ? "CHANNEL_ENABLED" : "CHANNEL_DISABLED",
          entityType: "Channel",
          entityId: id,
          metadata: { name: existing.name },
          ipAddress: clientIp(request),
        },
      });
      return updated;
    });
    return NextResponse.json(channel);
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: "通路狀態無法更新" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const { id } = await context.params;
    const channel = await prisma.channel.findUnique({
      where: { id },
      select: { id: true, name: true, _count: { select: { movements: true } } },
    });
    if (!channel) return NextResponse.json({ error: "找不到通路" }, { status: 404 });
    if (channel._count.movements > 0) {
      return NextResponse.json({ error: "通路已有庫存異動紀錄，請改用停用以保留帳務歷史" }, { status: 409 });
    }

    await prisma.$transaction([
      prisma.channel.delete({ where: { id } }),
      prisma.auditLog.create({
        data: { userId: auth.user.id, action: "CHANNEL_DELETED", entityType: "Channel", entityId: id, metadata: { name: channel.name }, ipAddress: clientIp(request) },
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return NextResponse.json({ error: "通路已有關聯紀錄，請改用停用" }, { status: 409 });
    }
    return NextResponse.json({ error: "通路無法刪除" }, { status: 500 });
  }
}
