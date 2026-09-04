import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, clientIp, requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { removeProductImages, saveProductImage } from "@/lib/uploads";

const commonSchema = z.object({
  name: z.string().trim().min(1).max(160),
  safetyStock: z.coerce.number().int().min(0).default(0),
  listPrice: z.union([z.literal(""), z.coerce.number().min(0)]).optional(),
  wholesalePrice: z.union([z.literal(""), z.coerce.number().min(0)]).optional(),
  unitCost: z.union([z.literal(""), z.coerce.number().min(0)]).optional(),
  description: z.string().trim().max(5000).optional(),
});

const singleSchema = commonSchema.extend({
  sku: z.string().trim().min(1).max(80),
  size: z.string().trim().max(30).optional(),
});

const batchSchema = commonSchema.extend({
  skuBase: z.string().trim().min(1).max(80),
  sizes: z.array(z.string().trim().max(30)).min(1).max(30),
});

function nullableAmount(value: number | "" | undefined) {
  return value === "" || value === undefined ? null : value;
}

function uniqueSizes(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const size = value.trim();
    const key = size.toLocaleUpperCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(size);
  }
  return result;
}

export async function POST(request: Request) {
  let storedImage: Awaited<ReturnType<typeof saveProductImage>> = null;
  try {
    assertSameOrigin(request);
    const auth = await requireApiUser({ roles: ["ADMIN", "STAFF"] });
    const form = await request.formData();
    const common = {
      name: form.get("name"),
      safetyStock: form.get("safetyStock"),
      listPrice: form.get("listPrice"),
      wholesalePrice: form.get("wholesalePrice"),
      unitCost: form.get("unitCost"),
      description: form.get("description"),
    };

    const rawSizes = form.get("sizes");
    const isBatch = typeof rawSizes === "string" && rawSizes.trim().length > 0;
    let variants: Array<{ sku: string; size: string | null }>;
    let parsedCommon: z.infer<typeof commonSchema>;

    if (isBatch) {
      let sizes: unknown;
      try {
        sizes = JSON.parse(rawSizes as string);
      } catch {
        return NextResponse.json({ error: "尺寸資料格式不正確" }, { status: 400 });
      }
      const parsed = batchSchema.safeParse({ ...common, skuBase: form.get("skuBase"), sizes });
      if (!parsed.success) return NextResponse.json({ error: "請檢查商品欄位與尺寸選擇" }, { status: 400 });
      parsedCommon = parsed.data;
      const skuBase = parsed.data.skuBase.replace(/-+$/, "");
      const sizesUnique = uniqueSizes(parsed.data.sizes);
      variants = sizesUnique.map((size) => ({
        sku: size ? `${skuBase}-${size}` : skuBase,
        size: size || null,
      }));
      if (variants.some((variant) => variant.sku.length > 80)) {
        return NextResponse.json({ error: "產生後的 SKU 不可超過 80 個字元" }, { status: 400 });
      }
    } else {
      const parsed = singleSchema.safeParse({ ...common, sku: form.get("sku"), size: form.get("size") });
      if (!parsed.success) return NextResponse.json({ error: "請檢查商品欄位" }, { status: 400 });
      parsedCommon = parsed.data;
      variants = [{ sku: parsed.data.sku, size: parsed.data.size || null }];
    }

    const duplicateInRequest = variants.find((variant, index) => variants.findIndex((candidate) => candidate.sku === variant.sku) !== index);
    if (duplicateInRequest) return NextResponse.json({ error: `SKU ${duplicateInRequest.sku} 重複` }, { status: 409 });

    const existing = await prisma.product.findFirst({
      where: { sku: { in: variants.map((variant) => variant.sku) } },
      select: { sku: true },
    });
    if (existing) return NextResponse.json({ error: `SKU ${existing.sku} 已存在` }, { status: 409 });

    const image = form.get("image");
    if (image instanceof File && image.size > 0) storedImage = await saveProductImage(image);

    const products = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const variant of variants) {
        const product = await tx.product.create({
          data: {
            sku: variant.sku,
            name: parsedCommon.name,
            size: variant.size,
            safetyStock: parsedCommon.safetyStock,
            listPrice: nullableAmount(parsedCommon.listPrice),
            wholesalePrice: nullableAmount(parsedCommon.wholesalePrice),
            unitCost: nullableAmount(parsedCommon.unitCost),
            description: parsedCommon.description || null,
            imagePath: storedImage?.imagePath ?? null,
            imageThumbPath: storedImage?.imageThumbPath ?? null,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: auth.user.id,
            action: "PRODUCT_CREATED",
            entityType: "Product",
            entityId: product.id,
            metadata: { sku: product.sku, batchSize: variants.length },
            ipAddress: clientIp(request),
          },
        });
        created.push(product);
      }
      return created;
    });

    return NextResponse.json({ products, count: products.length }, { status: 201 });
  } catch (error) {
    if (storedImage) await removeProductImages([storedImage.imagePath, storedImage.imageThumbPath]);
    const authError = authErrorResponse(error);
    if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "SKU 已存在" }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "SKU 已存在或資料無法儲存" }, { status: 409 });
  }
}
