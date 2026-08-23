import { randomUUID } from "crypto";
import sharp, { type Metadata } from "sharp";
import { objectStorage } from "@/lib/object-storage";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function saveProductImage(file: File) {
  if (file.size === 0) return null;
  if (file.size > MAX_IMAGE_BYTES) throw new Error("商品圖片不可超過 8 MB");

  const input = Buffer.from(await file.arrayBuffer());
  let metadata: Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: 40_000_000, animated: false }).metadata();
  } catch {
    throw new Error("無法讀取圖片，請使用 JPEG、PNG 或 WebP");
  }
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new Error("圖片格式只支援 JPEG、PNG 或 WebP");
  }

  const id = randomUUID();
  const imageKey = `products/${id}.webp`;
  const thumbKey = `products/${id}-thumb.webp`;
  const storage = objectStorage();

  try {
    const [image, thumbnail] = await Promise.all([
      sharp(input, { limitInputPixels: 40_000_000, animated: false })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer(),
      sharp(input, { limitInputPixels: 40_000_000, animated: false })
      .rotate()
      .resize({ width: 320, height: 320, fit: "cover", position: "centre" })
      .webp({ quality: 78 })
      .toBuffer(),
    ]);
    await storage.put(imageKey, image, "image/webp");
    await storage.put(thumbKey, thumbnail, "image/webp");
  } catch {
    await Promise.all([imageKey, thumbKey].map((key) => storage.delete(key).catch(() => undefined)));
    throw new Error("圖片處理失敗，請更換圖片後重試");
  }

  return { imagePath: imageKey, imageThumbPath: thumbKey };
}

export async function removeProductImages(paths: Array<string | null | undefined>) {
  const storage = objectStorage();
  await Promise.all(paths.filter((value): value is string => Boolean(value)).map((value) => storage.delete(value)));
}
