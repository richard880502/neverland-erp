import { randomUUID } from "crypto";
import { mkdir, rm } from "fs/promises";
import path from "path";
import sharp, { type Metadata } from "sharp";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function uploadRoot() {
  return path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR ?? "/tmp/stockflow-uploads");
}

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
  const directory = path.join(uploadRoot(), "products");
  const imageKey = `products/${id}.webp`;
  const thumbKey = `products/${id}-thumb.webp`;
  const imageFile = path.join(/* turbopackIgnore: true */ uploadRoot(), imageKey);
  const thumbFile = path.join(/* turbopackIgnore: true */ uploadRoot(), thumbKey);
  await mkdir(directory, { recursive: true });

  try {
    await sharp(input, { limitInputPixels: 40_000_000, animated: false })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84 })
      .toFile(imageFile);
    await sharp(input, { limitInputPixels: 40_000_000, animated: false })
      .rotate()
      .resize({ width: 320, height: 320, fit: "cover", position: "centre" })
      .webp({ quality: 78 })
      .toFile(thumbFile);
  } catch {
    await Promise.all([rm(imageFile, { force: true }), rm(thumbFile, { force: true })]);
    throw new Error("圖片處理失敗，請更換圖片後重試");
  }

  return { imagePath: imageKey, imageThumbPath: thumbKey };
}

export async function removeProductImages(paths: Array<string | null | undefined>) {
  await Promise.all(paths.filter((value): value is string => Boolean(value)).map((value) => rm(path.join(/* turbopackIgnore: true */ uploadRoot(), value), { force: true })));
}
