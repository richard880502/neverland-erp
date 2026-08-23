import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { removeProductImages } from "@/lib/uploads";

const updateSchema = z.object({ active: z.boolean() }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請提供正確的商品狀態" }, { status: 400 });
    const { id } = await context.params;
    const existing = await prisma.product.findUnique({ where: { id }, select: { id: true, sku: true } });
    if (!existing) return NextResponse.json({ error: "找不到商品" }, { status: 404 });

    const product = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id }, data: { active: parsed.data.active } });
      await tx.auditLog.create({
        data: {
          userId: auth.user.id,
          action: parsed.data.active ? "PRODUCT_ENABLED" : "PRODUCT_DISABLED",
          entityType: "Product",
          entityId: id,
          metadata: { sku: existing.sku },
          ipAddress: clientIp(request),
        },
      });
      return updated;
    });
    return NextResponse.json(product);
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: "商品狀態無法更新" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const { id } = await context.params;
    const product = await prisma.product.findUnique({
      where: { id },
      select: { id: true, sku: true, imagePath: true, imageThumbPath: true, _count: { select: { movements: true } } },
    });
    if (!product) return NextResponse.json({ error: "找不到商品" }, { status: 404 });
    if (product._count.movements > 0) {
      return NextResponse.json({ error: "商品已有庫存異動紀錄，請改用停用以保留帳務歷史" }, { status: 409 });
    }

    await prisma.$transaction([
      prisma.product.delete({ where: { id } }),
      prisma.auditLog.create({
        data: { userId: auth.user.id, action: "PRODUCT_DELETED", entityType: "Product", entityId: id, metadata: { sku: product.sku }, ipAddress: clientIp(request) },
      }),
    ]);
    try {
      await removeProductImages([product.imagePath, product.imageThumbPath]);
    } catch (error) {
      console.error("商品已刪除，但 MinIO 圖片清理失敗", error);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return NextResponse.json({ error: "商品已有關聯紀錄，請改用停用" }, { status: 409 });
    }
    return NextResponse.json({ error: "商品無法刪除" }, { status: 500 });
  }
}
