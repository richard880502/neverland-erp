import assert from "node:assert/strict";
import test from "node:test";
import { S3StorageProvider, isProductImageKey } from "../lib/object-storage";

test("product image keys stay restricted to generated WebP objects", () => {
  assert.equal(isProductImageKey("products/82cedc57-956c-4ed4-bf5b-cf71876a16f5.webp"), true);
  assert.equal(isProductImageKey("products/82cedc57-956c-4ed4-bf5b-cf71876a16f5-thumb.webp"), true);
  assert.equal(isProductImageKey("products/../../secrets.txt"), false);
  assert.equal(isProductImageKey("other/file.webp"), false);
});

test("get rejects keys outside the product image namespace", async () => {
  const storage = new S3StorageProvider({
    endpoint: "http://minio.internal:9000",
    bucket: "neverland-erp",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: "test-access", secretAccessKey: "test-secret" },
  });
  await assert.rejects(() => storage.get("other/file.webp"), /圖片路徑無效/);
});
