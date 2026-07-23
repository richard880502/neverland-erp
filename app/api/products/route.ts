import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { removeProductImages, saveProductImage } from "@/lib/uploads";

const schema = z.object({
  sku: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(160), size: z.string().trim().max(30).optional(),
  safetyStock: z.coerce.number().int().min(0).default(0),
  listPrice: z.union([z.literal(""), z.coerce.number().min(0)]).optional(),
  wholesalePrice: z.union([z.literal(""), z.coerce.number().min(0)]).optional(),
  unitCost: z.union([z.literal(""), z.coerce.number().min(0)]).optional(),
  description: z.string().trim().max(5000).optional(),
});

export async function POST(request: Request) {
  let storedImage: Awaited<ReturnType<typeof saveProductImage>> = null;
  try {
    assertSameOrigin(request); const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const form = await request.formData();
    const parsed = schema.safeParse({
      sku: form.get("sku"), name: form.get("name"), size: form.get("size"),
      safetyStock: form.get("safetyStock"), listPrice: form.get("listPrice"), wholesalePrice: form.get("wholesalePrice"),
      unitCost: form.get("unitCost"), description: form.get("description"),
    });
    if (!parsed.success) return NextResponse.json({ error: "請檢查商品欄位" }, { status: 400 });
    const image = form.get("image");
    if (image instanceof File && image.size > 0) storedImage = await saveProductImage(image);
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({ data: {
        ...parsed.data, size: parsed.data.size || null,
        listPrice: parsed.data.listPrice === "" ? null : parsed.data.listPrice,
        wholesalePrice: parsed.data.wholesalePrice === "" ? null : parsed.data.wholesalePrice,
        unitCost: parsed.data.unitCost === "" ? null : parsed.data.unitCost,
        description: parsed.data.description || null,
        imagePath: storedImage?.imagePath ?? null, imageThumbPath: storedImage?.imageThumbPath ?? null,
      } });
      await tx.auditLog.create({ data: { userId: auth.user.id, action: "PRODUCT_CREATED", entityType: "Product", entityId: created.id, metadata: { sku: created.sku }, ipAddress: clientIp(request) } });
      return created;
    });
    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    if (storedImage) await removeProductImages([storedImage.imagePath, storedImage.imageThumbPath]);
    const authError = authErrorResponse(error); if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "SKU 已存在" }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "SKU 已存在或資料無法儲存" }, { status: 409 });
  }
}
