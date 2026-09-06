import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { removeProductImages, saveProductImage } from "@/lib/uploads";

async function removeUnreferencedProductImages(paths: Array<string | null | undefined>) {
  for (const path of [...new Set(paths.filter((value): value is string => Boolean(value)))]) {
    const referenced = await prisma.product.findFirst({
      where: { OR: [{ imagePath: path }, { imageThumbPath: path }] },
      select: { id: true },
    });
    if (!referenced) await removeProductImages([path]);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let storedImage: Awaited<ReturnType<typeof saveProductImage>> = null;
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const { id } = await context.params;
    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File) || image.size <= 0) {
      return NextResponse.json({ error: "請選擇要上傳的商品圖片" }, { status: 400 });
    }

    const product = await prisma.product.findUnique({
      where: { id },
      select: { id: true, sku: true, name: true },
    });
    if (!product) return NextResponse.json({ error: "找不到商品" }, { status: 404 });

    const applyToSameName = form.get("applyToSameName") !== null;
    const targets = await prisma.product.findMany({
      where: applyToSameName ? { name: product.name } : { id },
      select: { id: true, sku: true, imagePath: true, imageThumbPath: true },
    });
    const oldPaths = targets.flatMap((target) => [target.imagePath, target.imageThumbPath]);

    storedImage = await saveProductImage(image);
    if (!storedImage) return NextResponse.json({ error: "圖片無法儲存" }, { status: 400 });

    await prisma.$transaction(async (tx) => {
      await tx.product.updateMany({
        where: { id: { in: targets.map((target) => target.id) } },
        data: { imagePath: storedImage!.imagePath, imageThumbPath: storedImage!.imageThumbPath },
      });
      await tx.auditLog.create({
        data: {
          userId: auth.user.id,
          action: "PRODUCT_IMAGE_UPDATED",
          entityType: "Product",
          entityId: id,
          metadata: {
            sku: product.sku,
            applyToSameName,
            affectedSkus: targets.map((target) => target.sku),
          },
          ipAddress: clientIp(request),
        },
      });
    });

    await removeUnreferencedProductImages(oldPaths).catch((error) => {
      console.error("商品圖片已更新，但舊圖片清理失敗", error);
    });

    return NextResponse.json({ ok: true, affected: targets.length, imageThumbPath: storedImage.imageThumbPath });
  } catch (error) {
    if (storedImage) await removeProductImages([storedImage.imagePath, storedImage.imageThumbPath]).catch(() => undefined);
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "商品圖片無法更新" }, { status: 500 });
  }
}
