import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { prisma } from "../lib/prisma";
import { isProductImageKey, objectStorage } from "../lib/object-storage";

const args = process.argv.slice(2);
if (!args.every((argument) => argument === "--dry-run")) throw new Error("只支援 --dry-run 參數");
const dryRun = args.includes("--dry-run");

async function main() {
  const storage = objectStorage();
  const root = path.resolve(process.env.LEGACY_UPLOAD_DIR ?? "/data/uploads");
  const products = await prisma.product.findMany({
    where: { OR: [{ imagePath: { not: null } }, { imageThumbPath: { not: null } }] },
    select: { imagePath: true, imageThumbPath: true },
  });
  const keys = [...new Set(products.flatMap((product) => [product.imagePath, product.imageThumbPath]).filter((key): key is string => Boolean(key)))];
  const summary = { dryRun, referenced: keys.length, uploaded: 0, skipped: 0, missingLocal: 0, sizeMismatch: 0, invalidKey: 0 };

  for (const key of keys) {
    if (!isProductImageKey(key)) {
      summary.invalidKey += 1;
      continue;
    }
    const source = path.resolve(root, key);
    if (!source.startsWith(`${root}${path.sep}`)) {
      summary.invalidKey += 1;
      continue;
    }
    let sourceSize: number;
    try {
      sourceSize = (await stat(source)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        summary.missingLocal += 1;
        continue;
      }
      throw error;
    }
    const remote = await storage.head(key);
    if (remote) {
      if (remote.size !== sourceSize) summary.sizeMismatch += 1;
      else summary.skipped += 1;
      continue;
    }
    if (dryRun) {
      summary.uploaded += 1;
      continue;
    }
    await storage.put(key, await readFile(source), "image/webp");
    const verified = await storage.head(key);
    if (!verified || verified.size !== sourceSize) throw new Error(`上傳後驗證失敗：${key}`);
    summary.uploaded += 1;
  }

  console.log(JSON.stringify(summary));
  if (summary.missingLocal || summary.sizeMismatch || summary.invalidKey) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
