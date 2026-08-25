import { PrismaClient, MovementType } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import path from "path";
import sharp from "sharp";
import { objectStorage } from "../lib/object-storage";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.ADMIN_PASSWORD ?? "change-me-now";
  const name = process.env.ADMIN_NAME ?? "系統管理員";
  const userCount = await prisma.user.count();
  let admin = await prisma.user.findUnique({ where: { email } });

  if (userCount === 0) {
    if (password.length < 10) throw new Error("首次部署的 ADMIN_PASSWORD 必須至少 10 字元");
    const passwordHash = await bcrypt.hash(password, 12);
    admin = await prisma.user.create({
      data: { email: email.toLowerCase(), passwordHash, name, role: "ADMIN", mustChangePassword: false },
    });
  } else if (!admin) {
    admin = await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, orderBy: { createdAt: "asc" } });
  }

  if (!admin) throw new Error("找不到有效的管理員，請檢查使用者資料");

  const medusaSyncEmail = "medusa-sync@internal.neverland";
  await prisma.user.upsert({
    where: { email: medusaSyncEmail },
    update: {},
    create: {
      email: medusaSyncEmail,
      name: "Medusa 自動同步",
      passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 12),
      role: "STAFF",
      active: true,
      mustChangePassword: false,
    },
  });

  const productRows = [
    ["N202512-M", "Family More Tee", "M", 3, 880],
    ["N202512-L", "Family More Tee", "L", 3, 880],
    ["N202511-M", "3N Logo Tee", "M", 2, 1280],
    ["N202511-L", "3N Logo Tee", "L", 2, 1280],
    ["N202510", "Lace X Plaid Du-Rag", "F", 2, 680],
  ] as const;

  const products = [];
  for (const [sku, name, size, safetyStock, unitCost] of productRows) {
    products.push(await prisma.product.upsert({
      where: { sku },
      update: {},
      create: { sku, name, size, safetyStock, unitCost },
    }));
  }

  const productImageAssets: Record<string, string> = {
    "N202512-M": "N202512.png",
    "N202512-L": "N202512.png",
    "N202511-M": "N202511.png",
    "N202511-L": "N202511.png",
    N202510: "N202510.png",
  };
  const storage = objectStorage();

  for (const product of products) {
    const assetName = productImageAssets[product.sku];
    if (!assetName || product.imagePath || product.imageThumbPath) continue;
    const assetPath = path.join(process.cwd(), "prisma", "seed-assets", "products", assetName);
    const imageId = createHash("sha256").update(`neverland:${product.sku}`).digest("hex").slice(0, 32);
    const imageKey = `products/${imageId}.webp`;
    const thumbKey = `products/${imageId}-thumb.webp`;

    const [image, thumbnail] = await Promise.all([
      sharp(assetPath, { limitInputPixels: 40_000_000, animated: false })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer(),
      sharp(assetPath, { limitInputPixels: 40_000_000, animated: false })
      .rotate()
      .resize({ width: 320, height: 320, fit: "cover", position: "centre" })
      .webp({ quality: 78 })
      .toBuffer(),
    ]);
    try {
      await storage.put(imageKey, image, "image/webp");
      await storage.put(thumbKey, thumbnail, "image/webp");
    } catch (error) {
      await Promise.all([imageKey, thumbKey].map((key) => storage.delete(key).catch(() => undefined)));
      throw error;
    }
    await prisma.product.update({ where: { id: product.id }, data: { imagePath: imageKey, imageThumbPath: thumbKey } });
  }

  const channelRows = [
    ["官網", "DIRECT"],
    ["蝦皮", "DIRECT"],
    ["Chambers", "CONSIGNMENT"],
    ["Zipper", "CONSIGNMENT"],
    ["DEF", "CONSIGNMENT"],
    ["Essence", "CONSIGNMENT"],
  ] as const;

  const channels = [];
  for (const [name, type] of channelRows) {
    channels.push(await prisma.channel.upsert({
      where: { name },
      update: {},
      create: { name, type },
    }));
  }

  if ((await prisma.stockMovement.count()) === 0) {
    const now = new Date();
    const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const rows: Array<[number, number, MovementType, number, number | null, number | null]> = [
      [0, 0, "RECEIVE", 20, null, null], [1, 0, "RECEIVE", 18, null, null],
      [2, 0, "RECEIVE", 16, null, null], [3, 0, "RECEIVE", 16, null, null],
      [4, 0, "RECEIVE", 12, null, null], [0, 2, "CONSIGN_OUT", 5, null, null],
      [1, 2, "CONSIGN_OUT", 4, null, null], [2, 4, "CONSIGN_OUT", 4, null, null],
      [0, 2, "CONSIGN_SOLD", 2, 1380, 24], [1, 2, "CONSIGN_SOLD", 1, 1380, 18],
      [2, 4, "CONSIGN_SOLD", 2, 1880, 12], [3, 1, "SHIP", 3, 1880, 9],
      [0, 0, "SHIP", 4, 1380, 7], [4, 1, "SHIP", 2, 980, 5],
      [2, 3, "CONSIGN_OUT", 3, null, null], [2, 3, "CONSIGN_SOLD", 1, 1880, 2],
    ];
    for (const [productIndex, channelIndex, type, quantity, unitPrice, days] of rows) {
      await prisma.stockMovement.create({
        data: {
          productId: products[productIndex].id,
          channelId: type === "RECEIVE" ? null : channels[channelIndex].id,
          type,
          quantity,
          unitPrice,
          occurredAt: daysAgo(days ?? 30),
          createdById: admin.id,
          note: "示範資料",
        },
      });
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
