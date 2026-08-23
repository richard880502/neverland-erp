import assert from "node:assert/strict";
import test from "node:test";
import { S3StorageProvider, isProductImageKey, signedReadUrlTtl } from "../lib/object-storage";

test("product image keys stay restricted to generated WebP objects", () => {
  assert.equal(isProductImageKey("products/82cedc57-956c-4ed4-bf5b-cf71876a16f5.webp"), true);
  assert.equal(isProductImageKey("products/82cedc57-956c-4ed4-bf5b-cf71876a16f5-thumb.webp"), true);
  assert.equal(isProductImageKey("products/../../secrets.txt"), false);
  assert.equal(isProductImageKey("other/file.webp"), false);
});

test("signed URL TTL is bounded for browser cache safety", () => {
  assert.equal(signedReadUrlTtl("900"), 900);
  assert.throws(() => signedReadUrlTtl("59"), /60 到 3600/);
  assert.throws(() => signedReadUrlTtl("3601"), /60 到 3600/);
});

test("presigned URLs use the browser-facing MinIO endpoint", async () => {
  const storage = new S3StorageProvider({
    endpoint: "http://minio.internal:9000",
    publicEndpoint: "https://objects.example.test",
    bucket: "neverland-erp",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: "test-access", secretAccessKey: "test-secret" },
  });
  const url = await storage.getSignedReadUrl("products/82cedc57-956c-4ed4-bf5b-cf71876a16f5-thumb.webp", 900);
  assert.match(url, /^https:\/\/objects\.example\.test\/neverland-erp\/products\//);
  assert.match(url, /X-Amz-Signature=/);
  assert.doesNotMatch(url, /minio\.internal/);
});
