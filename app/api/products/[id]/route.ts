import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { enqueueGoogleSheetProduct } from "@/lib/google-sheet-product-queue";
import { prisma } from "@/lib/prisma";
import { removeProductImages } from "@/lib/uploads";

const statusUpdateSchema = z.object({ active: z.boolean() }).strict();
const nullableAmount = z.number().finite().min(0).nullable();
const pricingUpdateSchema = z.object({
  listPrice: nullableAmount,
  wholesalePrice: nullableAmount,
  unitCost: nullableAmount,
}).strict();
const updateSchema = z.union([statusUpdateSchema, pricingUpdateSchema]);

async function removeUnreferencedProductImages(paths: Array<string | null | undefined>) {
  for (const path of [...new Set(paths.filter((value): value is string => Boolean(value)))]) {
    const referenced = await prisma.product.findFirst({
      where: { OR: [{ imagePath: path }, { imageThumbPath: path }] },
      select: { id: true },
    });
    if (!referenced) await removeProductImages([path]);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "請提供正確的商品更新資料" }, { status: 400 });

    const isStatusUpdate = "active" in parsed.data;
    if (!isStatusUpdate && auth.user.role !== "ADMIN") {
      return NextResponse.json({ error: "只有管理員可以修改定價、經銷價與單位成本" }, { status: 403 });
    }

    const { id } = await context.params;
    const existing = await prisma.product.findUnique({
      where: { id },
      select: { id: true, sku: true, listPrice: true, wholesalePrice: true, unitCost: true },
    });
    if (!existing) return NextResponse.json({ error: "找不到商品" }, { status: 404 });

    const product = await prisma.$transaction(async (tx) => {
      if ("active" in parsed.data) {
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
      }

      const updated = await tx.product.update({ where: { id }, data: parsed.data });
      await tx.auditLog.create({
        data: {
          userId: auth.user.id,
          action: "PRODUCT_PRICING_UPDATED",
          entityType: "Product",
          entityId: id,
          metadata: {
            sku: existing.sku,
            before: {
              listPrice: existing.listPrice == null ? null : Number(existing.listPrice),
              wholesalePrice: existing.wholesalePrice == null ? null : Number(existing.wholesalePrice),
              unitCost: existing.unitCost == null ? null : Number(existing.unitCost),
            },
            after: parsed.data,
          },
          ipAddress: clientIp(request),
        },
      });
      return updated;
    });
    return NextResponse.json(product);
  } catch (error) {
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: "商品資料無法更新" }, { status: 500 });
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

    await prisma.$transaction(async (tx) => {
      await enqueueGoogleSheetProduct(tx, product, "DELETE");
      await tx.product.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId: auth.user.id,
          action: "PRODUCT_DELETED",
          entityType: "Product",
          entityId: id,
          metadata: { sku: product.sku, googleSheetSyncQueued: true },
          ipAddress: clientIp(request),
        },
      });
    });
    try {
      await removeUnreferencedProductImages([product.imagePath, product.imageThumbPath]);
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
