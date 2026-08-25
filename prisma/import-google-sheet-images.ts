import { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { objectStorage } from "../lib/object-storage";

const prisma = new PrismaClient();

type ManifestRow = {
  cell: string;
  skus: string[];
  file?: string;
  mime?: string;
  bytes?: number;
  width?: number | null;
  height?: number | null;
  error?: string;
};

async function main() {
  const sourceDirectory = path.join(process.cwd(), "prisma", "google-sheet-images");
  const manifest = JSON.parse(await readFile(path.join(sourceDirectory, "manifest.json"), "utf8")) as ManifestRow[];
  const allSkus = manifest.flatMap((row) => row.skus);

  if (manifest.length !== 31 || allSkus.length !== 73 || new Set(allSkus).size !== 73) {
    throw new Error(`圖片清單筆數不符：${JSON.stringify({ groups: manifest.length, skuRefs: allSkus.length, uniqueSkus: new Set(allSkus).size })}`);
  }
  if (manifest.some((row) => row.error || !row.file)) throw new Error("圖片清單含擷取失敗項目");

  const productCount = await prisma.product.count({ where: { sku: { in: allSkus } } });
  if (productCount !== 73) throw new Error(`資料庫只找到 ${productCount}/73 個商品，已中止圖片匯入`);
  if (process.env.IMPORT_IMAGES_DRY_RUN === "1") {
    console.log(JSON.stringify({ dryRun: true, imageGroups: manifest.length, products: productCount }, null, 2));
    return;
  }

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("找不到有效的系統管理員，已中止圖片匯入");

  const storage = objectStorage();

  const previousProducts = await prisma.product.findMany({
    where: { sku: { in: allSkus } },
    select: { imagePath: true, imageThumbPath: true },
  });
  const previousPaths = new Set(previousProducts.flatMap((product) => [product.imagePath, product.imageThumbPath]).filter((value): value is string => Boolean(value)));
  const newPaths = new Set<string>();
  const updates: Array<{ skus: string[]; imagePath: string; imageThumbPath: string }> = [];

  try {
    for (const row of manifest) {
      const source = path.join(sourceDirectory, row.file!);
      const imageId = createHash("sha256").update(`neverland-sheet:${row.skus.join(",")}`).digest("hex").slice(0, 32);
      const imagePath = `products/${imageId}.webp`;
      const imageThumbPath = `products/${imageId}-thumb.webp`;
      const input = await readFile(source);
      const [full, thumbnail] = await Promise.all([
        sharp(input, { limitInputPixels: 40_000_000, animated: false }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toBuffer(),
        sharp(input, { limitInputPixels: 40_000_000, animated: false }).rotate().resize({ width: 320, height: 320, fit: "cover", position: "centre" }).webp({ quality: 78 }).toBuffer(),
      ]);
      newPaths.add(imagePath);
      newPaths.add(imageThumbPath);
      await storage.put(imagePath, full, "image/webp");
      await storage.put(imageThumbPath, thumbnail, "image/webp");
      updates.push({ skus: row.skus, imagePath, imageThumbPath });
    }
  } catch (error) {
    await Promise.all([...newPaths].map((key) => storage.delete(key).catch(() => undefined)));
    throw error;
  }

  await prisma.$transaction(async (tx) => {
    for (const update of updates) {
      const result = await tx.product.updateMany({
        where: { sku: { in: update.skus } },
        data: { imagePath: update.imagePath, imageThumbPath: update.imageThumbPath },
      });
      if (result.count !== update.skus.length) throw new Error(`圖片連結筆數不符：${update.skus.join(", ")}`);
    }
    await tx.auditLog.create({
      data: {
        userId: admin.id,
        action: "GOOGLE_SHEET_IMAGES_IMPORT",
        entityType: "Spreadsheet",
        entityId: "121W1NjIfpNk_nDX9TcpjtiaqokXKLwaOoPujQRoKaRE",
        metadata: { imageGroups: manifest.length, products: allSkus.length } as Prisma.InputJsonValue,
      },
    });
  }, { timeout: 120_000, maxWait: 20_000 });

  await Promise.all([...previousPaths].filter((oldPath) => !newPaths.has(oldPath)).map((oldPath) => storage.delete(oldPath)));

  const [linkedProducts, uniqueImagePaths] = await Promise.all([
    prisma.product.count({ where: { sku: { in: allSkus }, imagePath: { not: null }, imageThumbPath: { not: null } } }),
    prisma.product.findMany({ where: { sku: { in: allSkus } }, distinct: ["imagePath"], select: { imagePath: true } }),
  ]);
  if (linkedProducts !== 73 || uniqueImagePaths.length !== 31) {
    throw new Error(`圖片匯入後驗證失敗：${JSON.stringify({ linkedProducts, uniqueImagePaths: uniqueImagePaths.length })}`);
  }

  console.log(JSON.stringify({ imported: true, imageGroups: manifest.length, linkedProducts, uniqueImagePaths: uniqueImagePaths.length }, null, 2));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
