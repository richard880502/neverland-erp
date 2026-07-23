import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { generateSecret, generateURI, verify } from "otplib";

const ISSUER = "Neverland Operations";
const TOTP_PERIOD_SECONDS = 30;

function encryptionKey() {
  const configured = process.env.TOTP_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error("TOTP_ENCRYPTION_KEY_NOT_CONFIGURED");
  const key = /^[0-9a-f]{64}$/i.test(configured) ? Buffer.from(configured, "hex") : Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("TOTP_ENCRYPTION_KEY_INVALID");
  return key;
}

export function createTotpEnrollment(email: string) {
  const secret = generateSecret({ length: 20 });
  return {
    secret,
    uri: generateURI({ issuer: ISSUER, label: email, secret, algorithm: "sha1", digits: 6, period: TOTP_PERIOD_SECONDS }),
  };
}

export function encryptTotpSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptTotpSecret(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("TOTP_SECRET_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

export async function verifyTotpCode(secret: string, token: string, afterTimeStep?: number | null) {
  const normalized = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const result = await verify({
    secret,
    token: normalized,
    algorithm: "sha1",
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    epochTolerance: TOTP_PERIOD_SECONDS,
    ...(afterTimeStep == null ? {} : { afterTimeStep }),
  });
  return result.valid && "timeStep" in result ? result.timeStep : null;
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => randomBytes(10).toString("hex").toUpperCase().match(/.{1,4}/g)!.join("-"));
}

export function normalizeRecoveryCode(code: string) {
  return code.replace(/[^0-9a-f]/gi, "").toUpperCase();
}

export function hashRecoveryCode(code: string) {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

export function looksLikeRecoveryCode(code: string) {
  return /^[0-9A-F]{20}$/.test(normalizeRecoveryCode(code));
}
