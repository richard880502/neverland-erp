import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type ObjectHead = { size: number; contentType?: string };

export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<ObjectHead | null>;
  getSignedReadUrl(key: string, expiresIn?: number): Promise<string>;
}

const PRODUCT_KEY = /^products\/[a-f0-9-]+(?:-thumb)?\.webp$/;

export function isProductImageKey(key: string) {
  return PRODUCT_KEY.test(key);
}

function s3Config() {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY?.trim();
  const secretAccessKey = process.env.S3_SECRET_KEY?.trim();
  if (!endpoint || !publicEndpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("必須設定 S3_ENDPOINT、S3_PUBLIC_ENDPOINT、S3_BUCKET、S3_ACCESS_KEY 與 S3_SECRET_KEY");
  }
  return {
    endpoint,
    publicEndpoint,
    bucket,
    region: process.env.S3_REGION?.trim() || "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() !== "false",
    credentials: { accessKeyId, secretAccessKey },
  };
}

export function signedReadUrlTtl(value = process.env.S3_SIGNED_URL_TTL_SECONDS) {
  const parsed = Number(value ?? 900);
  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 3600) {
    throw new Error("S3_SIGNED_URL_TTL_SECONDS 必須介於 60 到 3600 秒");
  }
  return parsed;
}

export class S3StorageProvider implements ObjectStorage {
  private readonly client: S3Client;
  private readonly signingClient: S3Client;
  private readonly bucket: string;

  constructor(config = s3Config()) {
    this.bucket = config.bucket;
    this.client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: config.forcePathStyle, credentials: config.credentials });
    this.signingClient = new S3Client({ endpoint: config.publicEndpoint, region: config.region, forcePathStyle: config.forcePathStyle, credentials: config.credentials });
  }

  async put(key: string, body: Buffer, contentType: string) {
    if (!isProductImageKey(key)) throw new Error("圖片路徑無效");
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "private, max-age=86400",
    }));
  }

  async delete(key: string) {
    if (!isProductImageKey(key)) throw new Error("圖片路徑無效");
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async head(key: string): Promise<ObjectHead | null> {
    if (!isProductImageKey(key)) throw new Error("圖片路徑無效");
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: result.ContentLength ?? 0, contentType: result.ContentType };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (error as { name?: string }).name === "NotFound") return null;
      throw error;
    }
  }

  async getSignedReadUrl(key: string, expiresIn = signedReadUrlTtl()) {
    if (!isProductImageKey(key)) throw new Error("圖片路徑無效");
    return getSignedUrl(this.signingClient, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }
}

let provider: ObjectStorage | undefined;

export function objectStorage(): ObjectStorage {
  return provider ??= new S3StorageProvider();
}

export function resetObjectStorageForTests() {
  provider = undefined;
}
